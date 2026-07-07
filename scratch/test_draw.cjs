const font = {
  'A': [0x7e, 0x11, 0x11, 0x11, 0x7e],
  'B': [0x7f, 0x49, 0x49, 0x49, 0x36],
  'C': [0x3e, 0x41, 0x41, 0x41, 0x22],
  'D': [0x7f, 0x41, 0x41, 0x22, 0x1c],
  'E': [0x7f, 0x49, 0x49, 0x49, 0x41],
  'F': [0x7f, 0x09, 0x09, 0x09, 0x01],
  'G': [0x3e, 0x41, 0x49, 0x49, 0x7a],
  'H': [0x7f, 0x08, 0x08, 0x08, 0x7f],
  'I': [0x00, 0x41, 0x7f, 0x41, 0x00],
  'J': [0x20, 0x40, 0x41, 0x3f, 0x01],
  'K': [0x7f, 0x08, 0x14, 0x22, 0x41],
  'L': [0x7f, 0x40, 0x40, 0x40, 0x40],
  'M': [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  'N': [0x7f, 0x04, 0x08, 0x10, 0x7f],
  'O': [0x3e, 0x41, 0x41, 0x41, 0x3e],
  'P': [0x7f, 0x09, 0x09, 0x09, 0x06],
  'Q': [0x3e, 0x41, 0x51, 0x21, 0x5e],
  'R': [0x7f, 0x09, 0x19, 0x29, 0x46],
  'S': [0x26, 0x49, 0x49, 0x49, 0x32],
  'T': [0x01, 0x01, 0x7f, 0x01, 0x01],
  'U': [0x3f, 0x40, 0x40, 0x40, 0x3f],
  'V': [0x1f, 0x20, 0x40, 0x20, 0x1f],
  'W': [0x7f, 0x20, 0x18, 0x20, 0x7f],
  'X': [0x63, 0x14, 0x08, 0x14, 0x63],
  'Y': [0x07, 0x08, 0x70, 0x08, 0x07],
  'Z': [0x61, 0x51, 0x49, 0x45, 0x43],
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
  '?': [0x2d, 0x26, 0x49, 0x09, 0x06],
  '!': [0x00, 0x00, 0x5f, 0x00, 0x00]
};

function isPixelInTextManual(x, y) {
  // 1. Top line (TANZ): y from 68 to 88 (startY = 88)
  if (y >= 68 && y <= 88) {
    const dy = 88 - y;
    const relY = Math.floor(dy / 3); // 0..6
    
    // T: x from 25 to 39
    if (x >= 25 && x <= 39) {
      const relX = Math.floor((x - 25) / 3);
      const colByte = font['T'][relX];
      return (colByte & (1 << relY)) !== 0;
    }
    // A: x from 46 to 60
    if (x >= 46 && x <= 60) {
      const relX = Math.floor((x - 46) / 3);
      const colByte = font['A'][relX];
      return (colByte & (1 << relY)) !== 0;
    }
    // N: x from 67 to 81
    if (x >= 67 && x <= 81) {
      const relX = Math.floor((x - 67) / 3);
      const colByte = font['N'][relX];
      return (colByte & (1 << relY)) !== 0;
    }
    // Z: x from 88 to 102
    if (x >= 88 && x <= 102) {
      const relX = Math.floor((x - 88) / 3);
      const colByte = font['Z'][relX];
      return (colByte & (1 << relY)) !== 0;
    }
  }
  
  // 2. Bottom line (SCHEIN): y from 42 to 62 (startY = 62)
  if (y >= 42 && y <= 62) {
    const dy = 62 - y;
    const relY = Math.floor(dy / 3); // 0..6
    
    // S: x from 4 to 18
    if (x >= 4 && x <= 18) {
      const relX = Math.floor((x - 4) / 3);
      const colByte = font['S'][relX];
      return (colByte & (1 << relY)) !== 0;
    }
    // C: x from 25 to 39
    if (x >= 25 && x <= 39) {
      const relX = Math.floor((x - 25) / 3);
      const colByte = font['C'][relX];
      return (colByte & (1 << relY)) !== 0;
    }
    // H: x from 46 to 60
    if (x >= 46 && x <= 60) {
      const relX = Math.floor((x - 46) / 3);
      const colByte = font['H'][relX];
      return (colByte & (1 << relY)) !== 0;
    }
    // E: x from 67 to 81
    if (x >= 67 && x <= 81) {
      const relX = Math.floor((x - 67) / 3);
      const colByte = font['E'][relX];
      return (colByte & (1 << relY)) !== 0;
    }
    // I: x from 88 to 102
    if (x >= 88 && x <= 102) {
      const relX = Math.floor((x - 88) / 3);
      const colByte = font['I'][relX];
      return (colByte & (1 << relY)) !== 0;
    }
    // N: x from 109 to 123
    if (x >= 109 && x <= 123) {
      const relX = Math.floor((x - 109) / 3);
      const colByte = font['N'][relX];
      return (colByte & (1 << relY)) !== 0;
    }
  }
  
  return false;
}

const fs = require('fs');

let output = '';

// We loop y from 127 down to 0
for (let y = 127; y >= 0; y--) {
  let lineStr = '';
  // x goes from 0 to 127
  for (let x = 0; x <= 127; x++) {
    if (isPixelInTextManual(x, y)) {
      lineStr += '█';
    } else {
      lineStr += ' ';
    }
  }
  output += lineStr + '\n';
}

fs.writeFileSync('lyrics_debug.txt', output);
console.log('Successfully wrote debug frame to lyrics_debug.txt');
