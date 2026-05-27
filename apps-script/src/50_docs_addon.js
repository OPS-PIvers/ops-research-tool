/**
 * Google Docs editor add-on entry points.
 *
 * onInstall fires once when the add-on is installed for a user.
 * onOpen fires every time a document the add-on is installed in is opened.
 * showSidebar is the menu action that actually pops the HTML sidebar.
 *
 * Install path during dev:
 *   1. Apps Script editor → Deploy → Test deployments → install as
 *      "Editor Add-on" for your account.
 *   2. Open any Google Doc → Extensions menu → "OPS Research Tool" →
 *      "Open research panel".
 * Production path:
 *   - Publish via the Google Cloud project's Marketplace SDK with
 *     visibility set to the orono.k12.mn.us domain so the district
 *     admin can install it for all users.
 */

function onInstall(e) {
  onOpen(e);
}

function onOpen(e) {
  try {
    DocumentApp.getUi()
      .createAddonMenu()
      .addItem('Open research panel', 'showSidebar')
      .addToUi();
  } catch (err) {
    // The script may be invoked outside a Docs context (e.g. when the
    // web app is running). onOpen has no effect there — swallow silently.
  }
}

function showSidebar() {
  const t = HtmlService.createTemplateFromFile('sidebar');
  t.mode = 'sidebar';
  const html = t.evaluate()
    .setTitle('OPS Research Tool')
    .setWidth(360);
  DocumentApp.getUi().showSidebar(html);
}

/**
 * Reopen the sidebar UI as a wider modal dialog for citation editing.
 * The doc behind is uneditable while the dialog is open — explicit trade-off
 * for more horizontal room. Closing the dialog returns to the sidebar.
 *
 * Width is capped by Docs (~1000px on a typical screen). Height adapts.
 */
function sidebarOpenAsDialog() {
  const t = HtmlService.createTemplateFromFile('sidebar');
  t.mode = 'dialog';
  const html = t.evaluate()
    .setWidth(820)
    .setHeight(720);
  DocumentApp.getUi().showModalDialog(html, 'OPS Research Tool');
  return { ok: true };
}

/** Used by sidebar.html templating to embed sub-files (CSS + JS). */
function includeFile_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
