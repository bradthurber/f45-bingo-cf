# Adding Bingo Card Definitions

## Quick Start

When you receive card images for weeks 2-6 from the gym manager:

```bash
./upload-card.sh week2 /path/to/week2-card.jpg
./upload-card.sh week3 /path/to/week3-card.jpg
./upload-card.sh week4 /path/to/week4-card.jpg
./upload-card.sh week5 /path/to/week5-card.jpg
./upload-card.sh week6 /path/to/week6-card.jpg
```

## What it does

- Sends the image to OpenAI Vision API
- Extracts text from all 25 cells in the bingo card
- Stores the card definition in your D1 database
- Makes it available to all users via the app

## Example output

```json
{
  "ok": true,
  "week_id": "week2",
  "cells": [
    "Complete 10 workouts",
    "Drink 8 glasses of water daily",
    ...
  ],
  "created_at": "2026-02-04T12:34:56.789Z"
}
```

## Troubleshooting

**If the script fails:**
- Check that the image file exists and is readable
- Ensure you have curl installed
- Verify the image is a clear photo of the card
- Try a different image format (JPEG, PNG both work)

**If OpenAI extracts text incorrectly:**
- Take a clearer photo with better lighting
- Ensure the card is flat and not skewed
- Re-upload to overwrite the definition

## Security Note

The STUDIO_CODE is embedded in `upload-card.sh`. Keep this file secure and don't commit it to public repos.
