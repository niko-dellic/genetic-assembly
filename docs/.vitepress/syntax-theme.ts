import { createCssVariablesTheme } from 'shiki/core'

/** One token mapping for authored Markdown, generated API, and live JSON. */
export const syntaxTheme = createCssVariablesTheme({
  name: 'genetic-assembly-syntax',
  variablePrefix: '--code-',
  fontStyle: false,
})
