  export function xpRequiredForLevel(level) {
    let total = 0;
    for (let current = 0; current < level; current++) {
      total += (Math.floor(current / 10) + 1) * 100;
    }
    return total;
  }

  export function xpStepForLevel(level) {
    return (Math.floor(Math.max(0, level) / 10) + 1) * 100;
  }
