# Chrome Web Store privacy declarations

Use this mapping when completing the Privacy practices tab. Google requires disclosure even for data processed only on-device: <https://developer.chrome.com/docs/webstore/cws-dashboard-privacy> and <https://developer.chrome.com/docs/webstore/program-policies/user-data-faq/>.

The final selections must match the live form’s current labels and the public policy at <https://sourcing.kelmarvehiclesltd.co.uk/privacy>.

| Data category | Declare | Actual handling |
| --- | --- | --- |
| Personally identifiable information | Yes | Seller display name/profile URL may be extracted from the advert and sent to the private dashboard. Dashboard account email is stored by the web application. No seller profile traversal occurs. |
| Authentication information | Yes | The extension API token and dashboard URL are stored in `chrome.storage.local`; the token is sent only as a Bearer credential to the selected HTTPS dashboard. Facebook passwords/cookies are not uploaded. |
| Website content | Yes | Marketplace advert title, price, mileage, description, attributes, images, location, category evidence and related structured fields are processed locally and transmitted to the dashboard. |
| User activity | Yes | Explicit scan actions, progress/outcomes, source search/listing URLs and timestamps are processed for the sourcing workflow. There is no unrelated behaviour analytics. |
| Web history / browsing activity | Yes (conservative) | The extension handles the user-selected Marketplace search URL and listing URLs during an explicit scan. It does not collect general browsing history or run on unrelated sites. |
| Location | Yes (conservative) | Vehicle/listing location displayed in Marketplace may be stored. The extension does not request device location or GPS access. |
| Financial and payment information | No | Advert prices are website content, not the user’s bank, card, payment or financial-account data. |
| Health information | No | Not accessed. |
| Personal communications | No | Facebook messages, email and private seller communications are not accessed. Public seller advert descriptions are declared as website content. |

## Processing and storage

- On device: settings, API token, scan recovery state, progress, pending uploads and bounded listing caches in `chrome.storage.local`.
- Transmitted: structured scan/listing data and progress over HTTPS to the Kelmar dashboard.
- Server storage: Vercel-hosted application and Neon PostgreSQL database.
- Human access: authorised dealership dashboard users; exceptional support/security access only with permission or legal/security need.

## Required certifications

Certify only after confirming the submitted UI wording still matches these facts:

- data is used only to provide or improve the disclosed single purpose;
- data is not sold;
- data is not used or transferred for personalised advertising;
- data is not used for creditworthiness or lending;
- data is not transferred for unrelated purposes;
- collection/transmission is disclosed and uses HTTPS;
- remote code: **No, the extension does not use remote code**. All executable JavaScript is packaged; remote communication exchanges only HTML/JSON/data.

Limited Use statement for the public policy: “Use of information obtained through the extension complies with the Chrome Web Store User Data Policy, including its Limited Use requirements.”
