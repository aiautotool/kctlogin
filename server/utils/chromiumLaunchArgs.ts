export function getStableChromeArgs(extraArgs: string[] = []): string[] {
  return [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-skia-graphite',
    '--enforce-ipv4',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--disable-features=SkiaGraphite',
    ...extraArgs,
  ];
}
