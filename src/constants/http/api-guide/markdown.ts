// Small Markdown builders for the guide Swagger UI renders above the routes.
// Swagger UI renders Markdown with HTML allowed, so <details> gives collapsible sections.

const LINE = '\n';
const PARAGRAPH = '\n\n';
const CELL = ' | ';

const row = (cells: readonly string[]): string => `| ${cells.join(CELL)} |`;

export const md = {
  code: (text: string | number): string => `\`${text}\``,
  json: (value: unknown): string => `\`${JSON.stringify(value)}\``,
  // "/uploads/:id/complete" → "/uploads/{id}/complete", as the route list below shows it.
  path: (route: string): string => `\`${route.replace(/:(\w+)/g, '{$1}')}\``,
  table: (head: readonly string[], rows: readonly (readonly string[])[]): string =>
    [row(head), row(head.map(() => '---')), ...rows.map(row)].join(LINE),
  list: (items: readonly string[]): string => items.map((item) => `- ${item}`).join(LINE),
  steps: (items: readonly string[]): string =>
    items.map((item, index) => `${index + 1}. ${item}`).join(LINE),
  heading: (text: string): string => `#### ${text}`,
  blocks: (...parts: readonly string[]): string => parts.join(PARAGRAPH),
  details: (summary: string, ...body: readonly string[]): string =>
    `<details>${LINE}<summary><b>${summary}</b></summary>${PARAGRAPH}${body.join(PARAGRAPH)}${PARAGRAPH}</details>`,
};
