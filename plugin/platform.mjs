// Shared Go target mapping for the plugin runtime and release scripts.
export const PLATFORM_TARGETS = [
  {goos: 'linux', goarch: 'amd64'},
  {goos: 'linux', goarch: 'arm64'},
  {goos: 'darwin', goarch: 'amd64'},
  {goos: 'darwin', goarch: 'arm64'},
  {goos: 'windows', goarch: 'amd64'},
];

const platformNames = {win32: 'windows'};
const archNames = {x64: 'amd64', arm64: 'arm64'};

export function hostTarget(platform = process.platform, arch = process.arch) {
  const goos = platformNames[platform] || platform;
  const goarch = archNames[arch] || arch;
  return {goos, goarch, suffix: goos === 'windows' ? '.exe' : ''};
}
