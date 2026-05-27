/**
 * HTML serving for the Teacher Console.
 *
 * 30_endpoints.js doGet dispatches no-action requests here. Action-bearing
 * requests stay on the existing JSON dispatcher used by the Chrome extension.
 */

function serveConsoleHtml_() {
  const t = HtmlService.createTemplateFromFile('console');
  return t.evaluate()
    .setTitle('OPS Research Tool')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
