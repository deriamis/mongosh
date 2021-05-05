import { expect } from 'chai';
import { getPackageFile } from './get-package-file';

describe('tarball getPackageFile', () => {
  context('when the build variant is windows', () => {
    it('returns the windows tarball name', () => {
      expect(
        getPackageFile('win32-x64', '1.0.0', 'mongosh')
      ).to.deep.equal({
        path: 'mongosh-1.0.0-win32-x64.zip',
        contentType: 'application/zip'
      });
    });
  });

  context('when the build variant is macos', () => {
    it('returns the tarball details', () => {
      expect(
        getPackageFile('darwin-x64', '1.0.0', 'mongosh')
      ).to.deep.equal({
        path: 'mongosh-1.0.0-darwin-x64.zip',
        contentType: 'application/zip'
      });
    });
  });

  context('when the build variant is linux', () => {
    it('returns the tarball details', () => {
      expect(
        getPackageFile('linux-x64', '1.0.0', 'mongosh')
      ).to.deep.equal({
        path: 'mongosh-1.0.0-linux-x64.tgz',
        contentType: 'application/gzip'
      });
    });
  });

  context('when the build variant is debian', () => {
    it('returns the tarball details', () => {
      expect(
        getPackageFile('debian-x64', '1.0.0', 'mongosh')
      ).to.deep.equal({
        path: 'mongosh_1.0.0_amd64.deb',
        contentType: 'application/vnd.debian.binary-package'
      });
    });
  });

  context('when the build variant is rhel', () => {
    it('returns the tarball details', () => {
      expect(
        getPackageFile('rhel-x64', '1.0.0', 'mongosh')
      ).to.deep.equal({
        path: 'mongosh-1.0.0-x86_64.rpm',
        contentType: 'application/x-rpm'
      });
    });
  });
});
