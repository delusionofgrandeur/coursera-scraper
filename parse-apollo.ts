import fs from 'fs';

const apollo = JSON.parse(fs.readFileSync('apollo-state.json', 'utf8'));
const keys = Object.keys(apollo);
console.log(`Total items in Apollo State: ${keys.length}`);

// Find items that might be lessons or modules
const courseMaterials = keys.filter(k => k.includes('CourseMaterial'));
const items = keys.filter(k => k.includes('Item'));
console.log('Sample Course Materials:', courseMaterials.slice(0, 5));
console.log('Sample Items:', items.slice(0, 5));

const firstItemKey = items.find(i => apollo[i].contentSummary?.typeName === 'Video') || items[0];
if(firstItemKey) {
  console.log('Sample Item JSON:', JSON.stringify(apollo[firstItemKey], null, 2));
}

// Find modules
const modules = keys.filter(k => k.includes('Module'));
if(modules.length > 0) {
  console.log('Sample Module JSON:', JSON.stringify(apollo[modules[0]], null, 2));
}
