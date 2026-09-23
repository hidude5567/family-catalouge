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
table exists with the expected schema.

## Local-Only Mode

The app can be used without any external database by choosing “Skip for now” on the login page. In this mode, the catalog is stored in the browser and remains available only on that device/browser.

## Notes

- The project is designed for personal use rather than as a multi-user production app.
- Book metadata is fetched from Open Library, which may be unavailable or limited depending on network and browser conditions.
- Barcode scanning depends on browser support and camera permissions.

## License

No license has been specified for this repository yet.

## Website

'https://books-senter.appwrite.network/'
