// Close codes the apps understand on /ws (01-api §11).
export const WS_CLOSE = {
  authTimeout: 4000,
  // expired or invalid: refresh the token and reconnect
  token: 4001,
  forbidden: 4003,
  tooManySockets: 4008,
} as const;
