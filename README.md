# The Catalog

A lightweight personal book catalog app for tracking what is on your shelf. It supports browsing, searching, adding, editing, and removing books, with optional account-backed syncing through Supabase and a local-only fallback for quick use.

## Overview

The Catalog is a front-end web app for building a personal library collection. Users can:

- Add books manually
- Search by title, author, or genre
- Edit and remove entries
- Save to a browser-local catalog when offline or in local-only mode
- Sign in with Supabase-backed user accounts
- Import metadata from Open Library
- Scan barcodes with the device camera (when supported)

This project is built as a static HTML/CSS/JavaScript app, making it easy to host on any simple web server or static hosting platform.

## Features

- Personal bookshelf interface
- Search and genre filtering
- Book cards with cover art from Open Library ISBN metadata
- Manual entry or metadata lookup
- Barcode scanning support via the browser
- User authentication using Supabase
- Local-only mode with browser storage fallback
- Responsive layout for desktop and mobile browsers

## Tech Stack

- HTML
- CSS
- JavaScript
- Supabase (authentication + database sync)
- Open Library API (book lookup via title, author, or ISBN)
- Browser BarcodeDetector / ZXing fallback for barcode scanning

## Project Structure

```text
.
├── app.js            # Main catalog app logic
├── auth.js           # Login/signup and Supabase auth flow
├── index.html        # Main catalog page
├── login.html        # Sign-in page
├── style.css         # Styling and layout
├── package.json      # Minimal project metadata
└── README.md         # Project documentation
```

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/hidude5567/family-catalouge.git
cd family-catalouge
```

### 2. Run locally

Because this is a static web app, you can serve it with any local web server.

#### Option A: Python

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

#### Option B: Node

```bash
npx serve .
```

Then open the local URL shown in the terminal.

## Authentication and Sync

The app includes an authentication flow using Supabase.

- `login.html` handles sign-in and sign-up
- `app.js` checks the active session and loads the user-specific catalog
- If the account service is unavailable, the app offers a local-only mode
- In local-only mode, data is stored in `localStorage` instead of a remote database

If you want to enable full cloud syncing, configure the project’s Supabase credentials in the app scripts and make sure the `books` table exists with the expected schema.

## Local-Only Mode

The app can be used without any external database by choosing “Skip for now” on the login page. In this mode, the catalog is stored in the browser and remains available only on that device/browser.

## Notes

- The project is designed for personal use rather than as a multi-user production app.
- Book metadata is fetched from Open Library, which may be unavailable or limited depending on network and browser conditions.
- Barcode scanning depends on browser support and camera permissions.

## License

No license has been specified for this repository yet.

## Repository

- GitHub: https://github.com/hidude5567/family-catalouge
- Homepage: https://books-senter.appwrite.network/

## Contributing

Feel free to fork the repo and enhance the project with:

- better cover handling
- export/import support
- improved search and sorting
- richer shelf organization
- multi-user or team library features
