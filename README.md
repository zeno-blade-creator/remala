# Remala

Remala turns the laptop you already own into a free alarm clock, so your phone can charge outside your bedroom instead of in your bed.

Built as a prototype for ENGW 1111 (First-Year Writing) at Northeastern University.

## What it does

- Multiple alarms, each with its own time and color. Each day of the week belongs to one alarm, so you can wake up at 7:30 on weekdays and 9:45 on weekends.
- **Start alarm** turns the screen black, goes full screen, and asks the browser to keep the laptop awake.
- Rings with a loud two-tone beep until you press **I'm up**, then stays on for the next morning.
- Alarms are saved in your browser (localStorage), so closing the tab keeps your settings. No account needed.
- Warns you before you reload or close the tab while the alarm is on.

## Run it locally

```bash
npm install
npm run dev
```

## Limitations

The tab has to stay open, the lid open, and the laptop on power. A website can't raise your computer's volume, so use **Test sound** before bed.
