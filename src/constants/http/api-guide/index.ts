// The guide shown above the route list in /docs and stored in docs/openapi.json: what a
// route-by-route spec cannot say (errors, the WebSocket, multi-route flows).
import { md } from './markdown.js';
import { ERROR_CONTRACT_SECTION } from './error-contract.js';
import { WEBSOCKET_SECTION } from './websocket.js';
import { FLOWS_SECTION } from './flows.js';

export { ERROR_CONTRACT } from './error-contract.js';

export const API_GUIDE = md.blocks(ERROR_CONTRACT_SECTION, WEBSOCKET_SECTION, FLOWS_SECTION);
