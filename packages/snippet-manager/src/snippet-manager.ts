import { ShellPlugin, EvaluationListener } from '@mongosh/shell-evaluator';
import { MongoshRuntimeError, MongoshInvalidInputError } from '@mongosh/errors';
import escapeRegexp from 'escape-string-regexp';
import path from 'path';
import { promisify } from 'util';
import { Console } from 'console';
import { promises as fs } from 'fs';
import childProcess from 'child_process';
import stream, { PassThrough } from 'stream';
import fetch from 'node-fetch';
import tar from 'tar';
import zlib from 'zlib';
import bson from 'bson';
const execFile = promisify(childProcess.execFile);
const pipeline = promisify(stream.pipeline);
const brotliDecompress = promisify(zlib.brotliDecompress);

export interface SnippetOptions {
  installdir: string;
  rcFile: string;
  contextObject: any;
  indexURI: string;
  registryBaseUrl?: string;
}

export class SnippetManager implements ShellPlugin {
  installdir: string;
  indexURI: string;
  index: any;
  contextObject: any;
  rcFile: string;
  npmArgv: string[];
  registryBaseUrl: string;
  initialPrepareIndexPromise: Promise<unknown>; // For testing

  constructor({ installdir, rcFile, contextObject, indexURI, registryBaseUrl = 'https://registry.npmjs.org' }: SnippetOptions) {
    this.installdir = installdir;
    this.rcFile = rcFile;
    this.contextObject = contextObject;
    this.indexURI = indexURI;
    this.index = null;
    this.npmArgv = [];
    this.registryBaseUrl = registryBaseUrl;
    this.initialPrepareIndexPromise = this.prepareIndex().catch(() => {});
  }

  matchesCommand(cmd: string): boolean {
    return cmd === 'snippet';
  }

  async prepareNpm(evaluationListener: EvaluationListener): Promise<string[]> {
    const npmdir = path.join(this.installdir, 'node_modules', 'npm');
    const npmclipath = path.join(npmdir, 'bin', 'npm-cli.js');

    await fs.mkdir(this.installdir, { recursive: true });
    try {
      await fs.stat(npmclipath);
      return [process.execPath, npmclipath];
    } catch { /* ignore */ }
    try {
      const { stdout } = await execFile('npm', ['--version'], { encoding: 'utf8' });
      const major = +stdout.trim().split('.')[0];
      if (major >= 6) return ['npm'];
    } catch { /* ignore */ }

    const result = await evaluationListener.onPrompt?.(
      'This operation requires downloading a recent release of npm. Do you want to proceed? [Y/n]',
      'yesno');
    if (result === 'no') {
      throw new MongoshRuntimeError('Stopped by user request');
    }

    const metadataResponse = await fetch(this.registryBaseUrl + '/npm/latest');
    const npmTarball = await fetch((await metadataResponse.json()).dist.tarball);
    await fs.mkdir(npmdir, { recursive: true });
    await pipeline(npmTarball.body, tar.x({ strip: 1, C: npmdir }));
    await this.editPackageJSON((pjson) => { (pjson.dependencies ??= {}).npm = 'latest'; });
    return [process.execPath, npmclipath];
  }

  async prepareIndex(forceRefresh = false): Promise<any> {
    const cachePath = path.join(this.installdir, 'index.bson.br');
    await fs.mkdir(this.installdir, { recursive: true });
    let buf;
    try {
      buf = await fs.readFile(cachePath);
    } catch { /* ignore */ }

    if (!buf || forceRefresh) {
      buf = await (await fetch(this.indexURI)).buffer();
      try {
        await fs.writeFile(cachePath, buf);
      } catch { /* ignore */ }
    } else if (Date.now() - (await fs.stat(cachePath)).mtime.getTime() > 3600) {
      this.prepareIndex(true).catch(() => {});
    }

    const data = bson.deserialize(await brotliDecompress(buf));
    this.index = data.index;
    this.index.metadata = data.metadata;
    return this.index;
  }

  async ensureSetup(evaluationListener: EvaluationListener): Promise<string[]> {
    if (this.npmArgv.length > 0 && this.index) {
      return this.npmArgv;
    }

    [ this.npmArgv, this.index ] = await Promise.all([
      this.prepareNpm(evaluationListener),
      this.prepareIndex()
    ]);
    return this.npmArgv;
  }

  async editPackageJSON<T>(fn: (pjson: any) => T): Promise<T> {
    let pjson = {};
    try {
      pjson = JSON.parse(await fs.readFile(path.join(this.installdir, 'package.json'), 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
    const result = await fn(pjson);
    await fs.writeFile(path.join(this.installdir, 'package.json'), JSON.stringify(pjson, null, '  '));
    return result;
  }

  async runNpm(evaluationListener: EvaluationListener, ...npmArgs: string[]): Promise<string> {
    await this.editPackageJSON(() => {}); // Ensure package.json exists.
    const [ cmd, ...args ] = [
      ...await this.ensureSetup(evaluationListener),
      '--no-package-lock',
      '--ignore-scripts',
      `--registry=${this.registryBaseUrl}`,
      ...npmArgs
    ];
    try {
      return (await execFile(cmd, args, {
        cwd: this.installdir, env: { ...process.env, MONGOSH_RUN_NODE_SCRIPT: '1' }
      })).stdout;
    } catch (err) {
      if (err.code === 1 && err.stderr === '' && err.stdout) {
        return err.stdout;
      }
      throw err;
    }
  }

  async search(evaluationListener: EvaluationListener): Promise<string> {
    await this.ensureSetup(evaluationListener);
    const list = this.index.map(
      ({ snippetName, version, description }: any) =>
        ({ name: snippetName, version, description }));

    const tableOutput = new PassThrough({ encoding: 'utf8' });
    new Console(tableOutput).table(list);
    return tableOutput.read();
  }

  async updateRcfile(): Promise<void> {
    const installedPackages = await this.editPackageJSON((pjson) => Object.keys(pjson.dependencies ?? {}));
    const packageLoadCommands =
      installedPackages.map(p => {
        const relativePath = path.sep + path.relative(
          path.dirname(this.rcFile),
          path.resolve(this.installdir, 'node_modules', p));
        return `load(require.resolve(__dirname + ${JSON.stringify(relativePath)}));`;
      });
    const wantedContent = packageLoadCommands.length > 0 ? `\
// Managed snippets. Do not edit this part manually!
// Use snippet uninstall <name> to remove packages.
${packageLoadCommands.join('\n')}
// End of managed snippets
` : '';

    let rcFileContent = '';
    try {
      rcFileContent = await fs.readFile(this.rcFile, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        return;
      }
    }
    const existingMatch = rcFileContent.match(
      /\/\/ Managed snippets[\s\S]*\/\/ End of managed snippets/);

    if (existingMatch) {
      rcFileContent = rcFileContent.replace(existingMatch[0], wantedContent);
    } else if (wantedContent.length > 0) {
      if (!rcFileContent.endsWith('\n\n')) {
        rcFileContent += '\n';
      }
      rcFileContent += wantedContent;
    }

    await fs.writeFile(this.rcFile, rcFileContent);
  }

  expandPkgName = (name: string) => this.index.find(({ snippetName }: any) => snippetName === name)?.name;

  // eslint-disable-next-line complexity
  async runCommand(cmd: string, args: string[], evaluationListener: EvaluationListener): Promise<string> {
    switch (args[0]) {
      case 'help':
        return await this.helpText(args[1]);
      case 'install':
      case 'uninstall':
      case 'update': {
        await this.ensureSetup(evaluationListener);
        const missingSnippet = args.slice(1).find(arg => !this.expandPkgName(arg));
        if (missingSnippet !== undefined) {
          throw new MongoshInvalidInputError(`Unknown snippet "${missingSnippet}"`);
        }

        const fullPackageNames = args.slice(1).map(this.expandPkgName);
        await this.editPackageJSON((pjson) => {
          for (const pkg of fullPackageNames) {
            (pjson.dependencies ??= {})[pkg] = args[0] === 'uninstall' ? undefined : 'latest';
          }
        });
        await this.runNpm(evaluationListener, args[0], ...fullPackageNames);
        await this.updateRcfile();
        if (args[0] === 'install' && fullPackageNames.length > 0) {
          const loadNow = await evaluationListener.onPrompt?.(
            `Installed new snippets ${args.slice(1)}. Do you want to load them now? [Y/n]`,
            'yesno');
          if (loadNow !== 'no') {
            for (const pkg of fullPackageNames) {
              await this.contextObject.load(
                require.resolve(path.join(this.installdir, 'node_modules', pkg)));
            }
          }
          return `Finished installing snippets: ${args.slice(1)}`;
        }
        return 'Done!';
      }
      case 'outdated':
      case 'ls': {
        let output;
        if (args[0] === 'ls') {
          output = await this.runNpm(evaluationListener, 'ls', '--depth=0');
        } else {
          output = await this.runNpm(evaluationListener, args[0]);
        }
        for (const { name, snippetName } of this.index) {
          output = output.replace(new RegExp(escapeRegexp(name), 'g'), `mongosh:${snippetName}`);
        }
        return output;
      }
      case 'search':
        return await this.search(evaluationListener);
      case 'info':
        return await this.showInfo();
      default:
        return `Unknown command "${args[0]}". Run 'snippet help' to list all available commands.`;
    }
  }

  async helpText(snippet = ''): Promise<string> {
    if (snippet) {
      await this.prepareIndex();
      const info = this.index.find(({ snippetName }: any) => snippetName === snippet);
      if (!info) {
        throw new MongoshInvalidInputError(`Unknown snippet "${snippet}"`);
      }
      if (!info.readme) {
        throw new MongoshRuntimeError(`No help information available for "${snippet}"`);
      }
      return info.readme;
    }

    return `\
snippet <command> [args...]

  snippet install <name>     Install a new snippet
  snippet uninstall <name>   Remove an installed snippet
  snippet update             Get the latest versions of installed snippets
  snippet search             List available snippets
  snippet ls                 List installed snippets
  snippet outdated           List outdated snippets
  snippet help               Show this text
  snippet help <name>        Show information about a specific snippet
  snippet info               Show information about the snippet repository
`;
  }

  async showInfo(): Promise<string> {
    await this.prepareIndex();
    return `\
Snippet repository homepage:   ${this.index.metadata.homepage}
Snippet index URL:             ${this.indexURI}
`;
  }

  transformError(err: Error): Error {
    if (!this.index) return err;

    for (const { errorMatchers } of this.index) {
      for (const { matches, message } of errorMatchers ?? []) {
        for (const regexp of matches) {
          if (err.message.match(regexp)) {
            err.message += ` (${message})`;
            return err;
          }
        }
      }
    }
    return err;
  }
}
