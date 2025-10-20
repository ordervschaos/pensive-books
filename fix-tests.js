const fs = require('fs');

const file = 'src/lib/epub.test.ts';
let content = fs.readFileSync(file, 'utf8');

// Find all "it(" that have "await import" inside and make them async
const lines = content.split('\n');
const result = [];
let inTest = false;
let testStart = -1;
let needsAsync = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  if (line.match(/^\s*it\(/) && !line.includes('async')) {
    inTest = true;
    testStart = i;
    needsAsync = false;
  }
  
  if (inTest && line.includes('await import')) {
    needsAsync = true;
  }
  
  if (inTest && line.match(/^\s*}\);/)) {
    if (needsAsync && testStart >= 0) {
      // Make the test async
      result[testStart] = result[testStart].replace(/it\((.*)\) => \{/, 'it($1) => {').replace(') => {', ') async => {');
      if (!result[testStart].includes('async')) {
        result[testStart] = result[testStart].replace(') => {', 'async () => {');
      }
    }
    inTest = false;
    testStart = -1;
    needsAsync = false;
  }
  
  result.push(line);
}

fs.writeFileSync(file, result.join('\n'));
console.log('Fixed async/await issues');
