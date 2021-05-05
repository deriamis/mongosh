/* istanbul ignore file */
import path from 'path';
import { promises as fs, constants as fsConstants } from 'fs';
import { downloadMongoDb, DownloadOptions } from '../download-mongodb';
import { BuildVariant, getDistro, getArch } from '../config';

export async function downloadMongocrypt(variant: BuildVariant): Promise<string> {
  const opts: DownloadOptions = {};
  opts.arch = getArch(variant);
  switch (getDistro(variant)) {
    case 'win32':
    case 'win32msi':
      opts.distro = 'win32';
      break;
    case 'darwin':
      opts.distro = 'darwin';
      break;
    case 'linux':
    case 'debian':
      opts.distro = 'ubuntu1804';
      break;
    case 'rhel':
      opts.distro = 'rhel72';
      break;
    default:
      break;
  }
  console.info('mongosh: downloading latest mongocryptd for inclusion in package:', JSON.stringify(opts));

  const bindir = await downloadMongoDb(
    path.resolve(__dirname, '..', '..', '..', '..', 'tmp', 'mongocryptd-store', variant),
    '*',
    opts); // Download mongodb for latest server version.
  let mongocryptd = path.join(bindir, 'mongocryptd');
  if (opts.distro === 'win32') {
    mongocryptd += '.exe';
  }
  // Make sure that the binary exists and is executable.
  await fs.access(mongocryptd, fsConstants.X_OK);
  console.info('mongosh: downloaded', mongocryptd);
  return mongocryptd;
}
