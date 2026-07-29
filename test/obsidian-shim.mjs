export class TFile {}

export const Platform = {
  isMacOS: false,
  isMobile: false,
  isMobileApp: false,
}

export const normalizePath = path =>
  path.replaceAll('\\', '/').replace(/\/+/g, '/')
