const fs = require('fs');
const path = require('path');

const inlinePath = path.join(__dirname, 'results-inline.js');
const resultsPath = path.join(__dirname, 'results.txt');

function readJsonFromFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeInlineData(filePath, data) {
  const serialized = JSON.stringify(data, null, 2);
  const content = `window.inlineScrapedResults = ${serialized};\n`;
  fs.writeFileSync(filePath, content, 'utf8');
}

function updateLinks() {
  const resultsData = readJsonFromFile(resultsPath);

  if (!resultsData.resource) {
    throw new Error('results.txt does not contain resource data');
  }

  if (
    !Array.isArray(resultsData.resource.links) &&
    !Array.isArray(resultsData.resource.items)
  ) {
    throw new Error('results.txt must contain resource.links or resource.items array');
  }

  writeInlineData(inlinePath, resultsData);
  const resourceCount = Array.isArray(resultsData.resource.items)
    ? resultsData.resource.items.length
    : resultsData.resource.links.length;
  console.log(
    `Updated ${inlinePath} with ${resourceCount} resource items (entire payload replaced).`
  );
}

updateLinks();
