/**
 * HTML serving for the web app: the Teacher Console and the student
 * "My research" page.
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

/**
 * "My research" — every source in a project, editable outside the Doc. It is
 * the Docs sidebar list + the source editor on one page (research.html), with
 * the same sidebar* server functions behind it. The web app executes as the
 * owner and identifies the caller via Session.getActiveUser(), exactly like the
 * extension's calls, so students need no extra permissions to open it.
 *
 * ?projectId= (sent by the extension popup) picks the project to open on.
 * Project ids are UUIDs; anything else is stripped before it reaches the page.
 */
function serveResearchHtml_(params) {
  const t = HtmlService.createTemplateFromFile('research');
  t.requestedProjectId = String((params && params.projectId) || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  return t.evaluate()
    .setTitle('My research · OPS Research Tool')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
