import type { EvaluationListener } from '@mongosh/shell-evaluator';
import { SnippetManager } from './snippet-manager';
import chai, { expect } from 'chai';
import sinonChai from 'sinon-chai';
import sinon, { stubInterface, StubbedInstance } from 'ts-sinon';
import { once } from 'events';
import http from 'http';
import zlib from 'zlib';
import bson from 'bson';
import path from 'path';
import { promises as fs } from 'fs';
chai.use(sinonChai);

describe('SnippetManager', () => {
  let httpServer: http.Server;
  let baseURL = '';
  let indexData: any;
  let installdir: string;
  let rcFile: string;
  let contextObject: any;
  let makeSnippetManager: () => SnippetManager;
  let snippetManager: SnippetManager;
  let tmpdir: string;
  let indexURI: string;
  let evaluationListener: StubbedInstance<EvaluationListener>;

  beforeEach(async() => {
    indexData = {
      index: [
        {
          name: 'bson',
          snippetName: 'bson-example',
          version: '4.3.0',
          description: 'Placeholder text one',
          errorMatchers: [
            {
              matches: [/undefined is not a function/],
              message: 'Have you tried turning it off and on again?'
            }
          ],
          readme: 'Help text!'
        },
        {
          name: 'mongodb',
          snippetName: 'mongodb-example',
          version: '4.0.0-beta.3',
          description: 'Placeholder text two'
        },
      ],
      metadata: {
        homepage: 'https://example.org'
      }
    };
    httpServer = http.createServer((req, res) => {
      const compress = zlib.createBrotliCompress();
      compress.end(bson.serialize(indexData));
      compress.pipe(res);
    }).listen(0);
    await once(httpServer, 'listening');
    baseURL = `http://localhost:${(httpServer.address() as any).port}`;
    tmpdir = path.resolve(__dirname, '..', '..', '..', 'tmp', `snippettest-${Date.now()}-${Math.random()}`);
    installdir = path.join(tmpdir, 'snippets');
    rcFile = path.join(tmpdir, 'rcscript.js');
    contextObject = {};
    indexURI = `${baseURL}/index.bson.br`;

    makeSnippetManager = () => new SnippetManager({
      installdir,
      rcFile,
      contextObject,
      indexURI
    });
    snippetManager = makeSnippetManager();

    evaluationListener = stubInterface<EvaluationListener>();

    // make nyc happy when we spawn npm below
    await fs.mkdir(path.resolve(__dirname, '..', '..', '..', 'tmp', '.nyc_output', 'processinfo'), { recursive: true });
  });

  afterEach(async() => {
    await fs.rmdir(tmpdir, { recursive: true });
    httpServer.close();
  });

  it('matches against the "snippet" command', () => {
    expect(snippetManager.matchesCommand('foo')).to.equal(false);
    expect(snippetManager.matchesCommand('snippet')).to.equal(true);
  });

  it('tries to fetch index data when the plugin starts', async() => {
    await snippetManager.initialPrepareIndexPromise;
    expect(snippetManager.index).to.deep.equal(indexData.index);
    expect(snippetManager.index.metadata).to.deep.equal(indexData.metadata);
  });

  it('provides a help text when using `snippet help`', async() => {
    const result = await snippetManager.runCommand('snippet', ['help'], evaluationListener);
    expect(result).to.include('snippet install');
  });

  it('suggests using `snippet help` when using `snippet notacommand`', async() => {
    const result = await snippetManager.runCommand('snippet', ['notacommand'], evaluationListener);
    expect(result).to.include("Run 'snippet help'");
  });

  it('provides information about where snippet get its data from when using `snippet info`', async() => {
    const result = await snippetManager.runCommand('snippet', ['info'], evaluationListener);
    expect(result).to.match(/^Snippet repository homepage:\s*https:\/\/example.org$/m);
    expect(result).to.match(/^Snippet index URL:\s*http:\/\/localhost:\d+\/index.bson.br$/m);
  });

  it('provides information about specific packages `snippet help <pkg>`', async() => {
    const result = await snippetManager.runCommand('snippet', ['help', 'bson-example'], evaluationListener);
    expect(result).to.equal('Help text!');
    try {
      await snippetManager.runCommand('snippet', ['help', 'mongodb-example'], evaluationListener);
      expect.fail('missed exception');
    } catch (err) {
      expect(err.message).to.equal('No help information available for "mongodb-example"');
    }
    try {
      await snippetManager.runCommand('snippet', ['help', 'alhjgfakjhf'], evaluationListener);
      expect.fail('missed exception');
    } catch (err) {
      expect(err.message).to.equal('Unknown snippet "alhjgfakjhf"');
    }
  });

  it('lists all available packages when using `snippet search`', async() => {
    const result = await snippetManager.runCommand('snippet', ['search'], evaluationListener);
    expect(result).to.match(/bson-example.+│.+4\.3\.0.+│.+Placeholder text one/);
    expect(result).to.match(/mongodb-example.+│.+4\.0\.0.+│.+Placeholder text two/);
  });

  it('rewrites errors based on provided error matchers', async() => {
    expect(snippetManager.transformError(new Error('undefined is not a function')).message)
      .to.equal('undefined is not a function');
    await snippetManager.initialPrepareIndexPromise;
    expect(snippetManager.transformError(new Error('undefined is not a function')).message)
      .to.equal('undefined is not a function (Have you tried turning it off and on again?)');
    expect(snippetManager.transformError(new Error('foo is not a function')).message)
      .to.equal('foo is not a function');
  });

  it('will fail when trying to use `snippet install unknownsnippet`', async() => {
    try {
      await snippetManager.runCommand('snippet', ['install', 'unknownsnippet'], evaluationListener);
      expect.fail('missed exception');
    } catch (err) {
      expect(err.message).to.equal('Unknown snippet "unknownsnippet"');
    }
  });

  it('manages packages on disk', async function() {
    this.timeout(120_000);

    (evaluationListener.onPrompt as any).resolves('yes');
    contextObject.load = sinon.stub();
    await snippetManager.runCommand('snippet', ['install', 'bson-example'], evaluationListener);

    const installedPkgJson = path.join(installdir, 'node_modules', 'bson', 'package.json');
    const installed = JSON.parse(await fs.readFile(installedPkgJson, 'utf8'));
    expect(installed.name).to.equal('bson');

    expect(evaluationListener.onPrompt).to.have.been.calledWith(
      'Installed new snippets bson-example. Do you want to load them now? [Y/n]', 'yesno');
    expect(contextObject.load).to.have.been.calledWith(
      path.resolve(installedPkgJson, '..', installed.main));

    const rcFileContent = await fs.readFile(rcFile, 'utf8');
    expect(rcFileContent).to.include('Managed snippets. Do not edit this part manually!');
    expect(rcFileContent).to.include('load(require.resolve(__dirname + "/snippets/node_modules/bson"));');

    {
      const result = await snippetManager.runCommand('snippet', ['ls'], evaluationListener);
      expect(result).to.include(installdir);
      expect(result).to.match(/mongosh:bson-example@\d+\.\d+\.\d+/);
    }

    {
      installed.version = '4.2.0'; // not up to date in any case
      await fs.writeFile(installedPkgJson, JSON.stringify(installed));
      const result = await snippetManager.runCommand('snippet', ['outdated'], evaluationListener);
      expect(result).to.match(/mongosh:bson-example\s+4\.2\.0/);
    }

    {
      await snippetManager.runCommand('snippet', ['update'], evaluationListener);
      const result = await snippetManager.runCommand('snippet', ['outdated'], evaluationListener);
      expect(result.trim()).to.equal('');
    }

    {
      await snippetManager.runCommand('snippet', ['uninstall', 'bson-example'], evaluationListener);
      const result = await snippetManager.runCommand('snippet', ['ls'], evaluationListener);
      expect(result).to.match(/\bempty\b/);
    }
  });

  context('without a recent npm in $PATH', () => {
    let origPath = '';
    before(() => {
      origPath = process.env.PATH ?? '';
      process.env.PATH =
        path.resolve(__dirname, '..', 'test', 'fixtures', 'fakenpm5') + path.delimiter + process.env.PATH;
    });
    after(() => {
      process.env.PATH = origPath;
    });

    it('does not download npm if asked not to', async() => {
      (evaluationListener.onPrompt as any).resolves('no');
      try {
        await snippetManager.runCommand('snippet', ['install', 'bson-example'], evaluationListener);
        expect.fail('missed exception');
      } catch (err) {
        expect(err.message).to.equal('Stopped by user request');
      }
    });

    it('downloads npm if asked to', async function() {
      this.timeout(120_000);

      (evaluationListener.onPrompt as any).resolves('yes');
      contextObject.load = sinon.stub();
      await snippetManager.runCommand('snippet', ['install', 'bson-example'], evaluationListener);

      for (const pkg of ['bson', 'npm']) {
        const installedPkgJson = path.join(installdir, 'node_modules', pkg, 'package.json');
        const installed = JSON.parse(await fs.readFile(installedPkgJson, 'utf8'));
        expect(installed.name).to.equal(pkg);
      }
    });
  });

  it('re-fetches cached data if it is outdated', async() => {
    {
      const result = await snippetManager.runCommand('snippet', ['info'], evaluationListener);
      expect(result).to.include('https://example.org');
    }

    const yesterday = Date.now() / 1000 - 86400;
    await fs.utimes(path.join(installdir, 'index.bson.br'), yesterday, yesterday);
    indexData.metadata.homepage = 'https://somethingelse.example.org';

    snippetManager = makeSnippetManager();
    const httpRequestHit = once(httpServer, 'request');

    {
      const result = await snippetManager.runCommand('snippet', ['info'], evaluationListener);
      expect(result).to.include('https://example.org');
    }

    await httpRequestHit;
    {
      const result = await snippetManager.runCommand('snippet', ['info'], evaluationListener);
      expect(result).to.include('https://example.org');
    }
  });
});
