# Ritmo — sync today's steps

## Copy your private code
Open **My profile → Shortcuts & code → Copy my code**. Each participant uses their own code. It can update your steps, but cannot log in or read your account. Never publish it in an exported shortcut. Renew it in Settings if accidentally shared, then update your shortcut.

## Read today's steps in Apple Shortcuts
1. Add **Find Health Samples**: Type **Steps**, Start Date **is today**, Unit **count**, Group by **Day**, Sort by **None**, Limit **off**.
2. Add **Get Details of Health Samples**, select **Value**, using the previous result.
3. **Set Variable** to `PasosRitmo` using that value.
4. Use **Quick Look** to compare with today's total in Health before syncing. **Log Health Sample** writes new data; it does not read your steps.

Don't add overlapping iPhone and Watch samples blindly: they may record the same walk. Health accuracy and source deduplication must be verified on your device. Stop if permission or data is missing; don't invent a zero. Zero means a known measurement of zero steps.

## Send to Ritmo
1. Add **URL**: `https://ritmo.eduzsantillan.com/api/steps`.
2. Add **Get Contents of URL** using that URL:
   - Method: **POST**.
   - Headers: leave empty. No Authorization or Bearer.
   - Request Body: **JSON**.
   - Add `userCode` as **Text**: paste your private code.
   - Add `steps` as **Number**: insert only the `PasosRitmo` variable. Remove the default `0`; don't type the variable's name as text or add units.
3. Add **Show Result** and run with the iPhone unlocked. Review and grant Steps-reading and domain-connection permissions when prompted.

Example body (use your real total, not this sample):
```json
{"userCode":"YOUR_PRIVATE_CODE","steps":90}
```
Successful responses include `accepted: 1`, `date`, and `syncedAt`. Open your profile or refresh the challenge to check the total.

The server calculates the date when steps arrive, using your profile time zone. Your phone and profile should use the same zone. Each send replaces today's total; it doesn't add it again. Don't send dates, time zones, challenge IDs, passwords or cookies. This is for today, not importing past days. Local dates are compared across participants; use the same phone time zone for the same daily cutoff.

## Troubleshooting
- Invalid code: copy it again from your profile. Renewing revokes the old code. Demo codes and legacy challenge keys won't work.
- Profile time zone missing: open your profile first.
- Invalid steps: use Number, a whole number from 0 to 250000, no prefixes or units.
- “The network connection was lost”: test a separate shortcut with GET `https://ritmo.eduzsantillan.com/api/status` and no headers. Compare Safari, Wi-Fi and cellular. Share only the response, never your private code.
- Too many requests: wait a minute. Don't create a permanent loop.

## Sharing and automation
You can share a template via iCloud, but remove your code first. Each user must provide their own code and approve permissions. Personal automations are configured separately on each iPhone. Shortcuts does not offer a dependable continuous 10-minute background schedule. Scheduled runs, Health access while locked and device-specific totals must be tested on each device; this isn't guaranteed real-time syncing.
