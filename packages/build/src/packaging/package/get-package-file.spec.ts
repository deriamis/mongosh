import { expect } from 'chai';
import { BuildVariant } from '../../config';
import { getPackageFile } from './get-package-file';

describe('tarball getPackageFile', () => {
  context('when the build variant is windows', () => {
    it('returns the windows tarball name', () => {
      expect(
        getPackageFile(BuildVariant.Windows, '1.0.0', 'mongosh')
      ).to.deep.equal({
        path: 'mongosh-1.0.0-win32.zip',
        contentType: 'application/zip'
      });
    });
  });

  context('when the build variant is windows MSI', () => {
    it('returns the windows MSI name', () => {
      expect(
        getPackageFile(BuildVariant.WindowsMSI, '1.0.0', 'mongosh')
      ).to.deep.equal({
        path: 'mongosh-1.0.0.msi',
        contentType: 'application/x-msi'
      });
    });
  });

  context('when the build variant is macos', () => {
    it('returns the tarball details', () => {
      expect(
        getPackageFile(BuildVariant.MacOs, '1.0.0', 'mongosh')
      ).to.deep.equal({
        path: 'mongosh-1.0.0-darwin.zip',
        contentType: 'application/zip'
      });
    });
  });

  context('when the build variant is linux', () => {
    it('returns the tarball details', () => {
      expect(
        getPackageFile(BuildVariant.Linux, '1.0.0', 'mongosh')
      ).to.deep.equal({
        path: 'mongosh-1.0.0-linux.tgz',
        contentType: 'application/gzip'
      });
    });
  });

  context('when the build variant is debian', () => {
    it('returns the tarball details', () => {
      expect(
        getPackageFile(BuildVariant.Debian, '1.0.0', 'mongosh')
      ).to.deep.equal({
        path: 'mongosh_1.0.0_amd64.deb',
        contentType: 'application/vnd.debian.binary-package'
      });
    });
  });

  context('when the build variant is rhel', () => {
    it('returns the tarball details', () => {
      expect(
        getPackageFile(BuildVariant.Redhat, '1.0.0', 'mongosh')
      ).to.deep.equal({
        path: 'mongosh-1.0.0-x86_64.rpm',
        contentType: 'application/x-rpm'
      });
    });
  });
});
