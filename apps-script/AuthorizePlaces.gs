// Run once from the Apps Script editor whenever external-request access needs
// to be authorised for the deployed Places proxy.
function authorizePlacesRequests() {
  return UrlFetchApp.fetch("https://www.google.com/generate_204", {
    muteHttpExceptions: true,
  }).getResponseCode();
}
