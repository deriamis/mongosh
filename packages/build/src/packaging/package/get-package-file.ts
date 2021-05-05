import { BuildVariant, getDistro, getArch, getDebArchName, getRPMArchName } from '../../config';

export interface PackageFile {
  path: string;
  contentType: string;
}

export function getPackageFile(buildVariant: BuildVariant, version: string, name: string): PackageFile {
  switch (getDistro(buildVariant)) {
    case 'linux':
      return {
        path: `${name}-${version}-${buildVariant}.tgz`,
        contentType: 'application/gzip'
      };
    case 'rhel':
      return {
        path: `${name}-${version}-${getRPMArchName(getArch(buildVariant))}.rpm`,
        contentType: 'application/x-rpm'
      };
    case 'debian':
      // debian packages are required to be separated by _ and have arch in the
      // name: https://www.debian.org/doc/manuals/debian-faq/pkg-basics.en.html
      // sometimes there is also revision number, but we can add that later.
      return {
        path: `${name}_${version}_${getDebArchName(getArch(buildVariant))}.deb`,
        contentType: 'application/vnd.debian.binary-package'
      };
    case 'darwin':
    case 'win32':
      return {
        path: `${name}-${version}-${buildVariant}.zip`,
        contentType: 'application/zip'
      };
    case 'win32msi':
      return {
        path: `${name}-${version}-${buildVariant}.msi`,
        contentType: 'application/x-msi'
      };
    default:
      throw new Error(`Unknown build variant: ${buildVariant}`);
  }
}
