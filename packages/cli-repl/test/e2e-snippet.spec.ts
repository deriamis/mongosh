import { promises as fs } from 'fs';
import path from 'path';
import { expect } from 'chai';
import { TestShell } from './test-shell';
import { useTmpdir } from './repl-helpers';
import { eventually } from './helpers';

describe('snippet integration tests', function() {
  this.timeout(120_000);
  const tmpdir = useTmpdir();

  let shell: TestShell;
  beforeEach(async() => {
    shell = TestShell.start({
      args: ['--nodb'],
      cwd: tmpdir.path,
      env: {
        ...process.env,
        HOME: tmpdir.path,
        APPDATA: tmpdir.path,
        LOCALAPPDATA: tmpdir.path
      }
    });
    await shell.waitForPrompt();
    shell.assertNoErrors();

    // make nyc happy when spawning npm below
    await fs.mkdir(path.join(tmpdir.path, '.mongodb', '.nyc_output', 'processinfo'), { recursive: true });
  });
  afterEach(async() => {
    await TestShell.killall();
  });

  it('allows managing snippets', async() => {
    shell.writeInputLine('snippet install analyze-schema');
    await eventually(() => {
      shell.assertContainsOutput('Installed new snippets analyze-schema. Do you want to load them now?');
    }, { timeout: 90_000 });
    shell.writeInputLine('Y');
    await shell.waitForPrompt();

    const installed = await shell.executeLine('snippet ls');
    expect(installed).to.include(tmpdir.path);
    expect(installed).to.match(/mongosh:analyze-schema@/);

    const analyzedSchema = await shell.executeLine(`\
      schema({
        tryNext() {
          return (this.i = (this.i + 1) || 0) < 10 ? { prop: "value" } : null;
        }
      })`);
    expect(analyzedSchema).to.match(/\bprop\b.+100.0 %.+\bString\b/);
    shell.assertNoErrors();
  });
});
