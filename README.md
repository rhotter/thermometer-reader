# ReadoutCam

A web app that reads numbers from your camera using AI. Point your camera at any numeric display (thermometer, gauge, meter, scale, etc.) and it will automatically read the values.

## Features

- Live webcam video stream
- Drag to select a crop region for the number display
- Auto-read at configurable intervals (2s, 5s, 10s, 30s)
- Live chart showing readings over time
- Download readings as CSV

## Setup

```bash
npm install
cp .env.example .env.local
# Add your OpenAI API key to .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

```bash
vercel
vercel env add OPENAI_API_KEY
vercel --prod
```
