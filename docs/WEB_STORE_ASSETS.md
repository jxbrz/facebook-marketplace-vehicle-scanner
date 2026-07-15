# Chrome Web Store asset plan

Official image guidance: <https://developer.chrome.com/docs/webstore/images> and listing fields: <https://developer.chrome.com/docs/webstore/cws-dashboard-listing>.

## Packaged icons

The package contains PNG icons at 16, 32, 48 and 128 px under `icons/`. The 128 px image uses transparent padding around the square artwork, following Google’s 96 px artwork plus 16 px per-side guidance. Re-run `npm run icons:generate` for deterministic copies.

## Store assets to prepare manually

- Store icon: packaged `icons/icon-128.png`, 128×128 PNG.
- Screenshots: 1280×800 PNG or JPEG, at least one and no more than five.
- Small promo tile: 440×280 PNG or JPEG, required by current listing guidance.
- Marquee tile: 1400×560 PNG or JPEG, optional.
- YouTube demonstration: optional unless the dashboard requires it in the current submission UI.

Naming convention:

```text
store-assets/01-popup-filters-1280x800.png
store-assets/02-running-scan-1280x800.png
store-assets/03-completed-results-1280x800.png
store-assets/04-vehicle-detail-1280x800.png
store-assets/05-saved-vehicles-1280x800.png
store-assets/promo-small-440x280.png
store-assets/promo-marquee-1400x560.png
```

`store-assets/` is deliberately not part of the extension ZIP and must contain only reviewed, sanitised media.

## Capture checklist

1. Popup with representative make/model, price, year, mileage and transmission filters; API token field empty or completely redacted.
2. Running scan panel with bounded 1/5/120 test settings and no personal Facebook header/notifications.
3. Completed private dashboard results using sanitised representative adverts.
4. Vehicle detail page showing gallery/attributes without seller phone number or private contact details.
5. Saved Vehicles workspace with fictional/sanitised internal notes.

Before upload confirm every capture has:

- no API token, password, private email inbox, seller telephone number or Facebook notification;
- no unrelated tabs, DevTools, personal bookmarks/profile data or browser sync identity;
- no claims or UI for MOT, valuation, OCR, HPI or other unimplemented features;
- only realistic data captured from an authorised test workflow, with identifying data redacted;
- an accurate representation of the submitted v23.0.4 build.

Do not fabricate screenshots. Capture them from the validated private test installation.
