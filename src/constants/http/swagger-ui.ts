// How the API explorer (/docs) looks and behaves on top of the stock Swagger UI.

// Swagger UI's bar holding the Authorize button; it shares a parent with the route list,
// so `position: sticky` keeps it on screen the whole way down.
const AUTH_BAR = '.swagger-ui .scheme-container';
const AUTH_BAR_ROW = `${AUTH_BAR} .schemes`;
// Swagger UI marks the button "btn authorize locked" once a token is set, and each
// route's lock button carries this aria-label while that token applies to it.
const AUTHORIZED_BAR = `${AUTH_BAR}:has(.btn.authorize.locked)`;
const AUTHORIZED_BUTTON = '.swagger-ui .btn.authorize.locked';
const AUTHORIZED_ROUTE_LOCK =
  '.swagger-ui .authorization__btn[aria-label="authorization button locked"]';

const BAR_LAYER = 10;
const BAR_PADDING = '12px 0';
const BAR_EDGE = '3px';
const LABEL_FONT = '600 15px sans-serif';
const BUTTON_FONT_SIZE = '14px';

// Each state: the label's text and colour, and a tint laid over the bar's own (opaque) background.
const SIGNED_OUT = {
  label: '⚠ Not authorized: signed-in routes will return 401',
  color: '#e0a800',
  tint: 'rgba(224, 168, 0, 0.12)',
};
const SIGNED_IN = {
  label: '✓ Authorized: every signed-in route sends your token',
  color: '#43a047',
  tint: 'rgba(67, 160, 71, 0.16)',
};
const BUTTON_TEXT_COLOR = '#ffffff';
const BUTTON_LABEL = '✓ Authorized';

const barState = (state: typeof SIGNED_OUT): string => `
  background-image: linear-gradient(${state.tint}, ${state.tint});
  box-shadow: inset 0 -${BAR_EDGE} 0 ${state.color};
`;

const AUTH_CSS = `
${AUTH_BAR} {
  position: sticky;
  top: 0;
  z-index: ${BAR_LAYER};
  padding: ${BAR_PADDING};
  ${barState(SIGNED_OUT)}
}
${AUTH_BAR_ROW} { align-items: center; }
${AUTH_BAR_ROW}::before {
  margin-right: auto;
  content: '${SIGNED_OUT.label}';
  font: ${LABEL_FONT};
  color: ${SIGNED_OUT.color};
}
${AUTHORIZED_BAR} { ${barState(SIGNED_IN)} }
${AUTHORIZED_BAR} .schemes::before { content: '${SIGNED_IN.label}'; color: ${SIGNED_IN.color}; }
${AUTHORIZED_BUTTON} {
  background: ${SIGNED_IN.color};
  border-color: ${SIGNED_IN.color};
  color: ${BUTTON_TEXT_COLOR};
}
${AUTHORIZED_BUTTON} svg path { fill: ${BUTTON_TEXT_COLOR}; }
${AUTHORIZED_BUTTON} span { font-size: 0; }
${AUTHORIZED_BUTTON} span::after { content: '${BUTTON_LABEL}'; font-size: ${BUTTON_FONT_SIZE}; }
${AUTHORIZED_ROUTE_LOCK} svg path { fill: ${SIGNED_IN.color}; }
`;

// Closes the Authorize dialog once a token is set. The page's config is plain JSON, so the
// plugin goes in by wrapping SwaggerUIBundle: theme scripts run before the window.onload
// that starts Swagger UI. showDefinitions(false) is what the dialog's Close button calls.
const CLOSE_ON_AUTHORIZE_JS = `(() => {
  const bundle = window.SwaggerUIBundle;
  const hasValue = (payload) => Object.values(payload || {}).some((auth) => auth && auth.value);
  const closeOnAuthorize = () => ({
    statePlugins: {
      auth: {
        wrapActions: {
          authorize: (original, system) => (payload) => {
            const result = original(payload);
            if (hasValue(payload)) system.authActions.showDefinitions(false);
            return result;
          },
        },
      },
    },
  });
  window.SwaggerUIBundle = Object.assign(
    (config) => bundle({ ...config, plugins: [...(config.plugins || []), closeOnAuthorize] }),
    bundle,
  );
})();
`;

export const SWAGGER_UI = {
  theme: {
    css: [{ filename: 'auth-status.css', content: AUTH_CSS }],
    js: [{ filename: 'close-on-authorize.js', content: CLOSE_ON_AUTHORIZE_JS }],
  },
  // Keeps the pasted token across page reloads (stored in the browser only).
  uiConfig: { persistAuthorization: true },
} as const;
