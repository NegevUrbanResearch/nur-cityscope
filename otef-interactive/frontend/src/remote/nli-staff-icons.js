const RAW = {
  play: '<svg xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M320-203v-560l440 280-440 280Z"/></svg>',
  pause: '<svg xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M555-200v-560h175v560H555Zm-325 0v-560h175v560H230Z"/></svg>',
  stop: '<svg xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M240-240v-480h480v480H240Z"/></svg>',
  repeat: '<svg xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M280-80 120-240l160-160 42 44-86 86h464v-160h60v220H236l86 86-42 44Zm-80-450v-220h524l-86-86 42-44 160 160-160 160-42-44 86-86H260v160h-60Z"/></svg>',
  chevronLeft: '<svg xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M561-240 320-481l241-241 43 43-198 198 198 198-43 43Z"/></svg>',
  chevronRight: '<svg xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M530-481 332-679l43-43 241 241-241 241-43-43 198-198Z"/></svg>',
  expandMore: '<svg xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M480-360 280-560h400L480-360Z"/></svg>',
};

export function materialIcon(name, size = 24) {
  const raw = RAW[name];
  if (!raw) return "";
  return raw
    .replace(
      "<svg",
      '<svg class="mi" aria-hidden="true" focusable="false" fill="currentColor"',
    )
    .replace(/height="48"/, `height="${size}"`)
    .replace(/width="48"/, `width="${size}"`);
}

function arrowButtonContent(label, path, iconFirst) {
  const icon = `<svg class="mi" aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
  const text = String(label).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const caption = `<span>${text}</span>`;
  return iconFirst ? icon + caption : caption + icon;
}

export function navigationButtonContent(label, action, locale) {
  const previous = action === "previous";
  const pointsLeft = previous ? locale !== "he" : locale === "he";
  const path = pointsLeft ? "M19 12H5m6-6-6 6 6 6" : "M5 12h14m-6-6 6 6-6 6";
  return arrowButtonContent(label, path, previous);
}

export function scrollButtonContent(label, direction) {
  const up = direction === "up";
  const path = up ? "M12 19V5m-6 6 6-6 6 6" : "M12 5v14m-6-6 6 6 6-6";
  return arrowButtonContent(label, path, up);
}
