# 🏨 Hotel Maxx - Luxury Hotel Website

A beautiful, modern 4-star hotel website for **Hotel Maxx** located in Kohalpur, Banke, Nepal. Features an AI-powered assistant, room booking system, and stunning visual design.

## ✨ Features

### AI-Powered Smart Assistant
- **24/7 AI Chat** — Guests can ask about hotel services, amenities, location, and more
- **Powered by Google Gemini** — Intelligent responses with hotel-specific context
- **Live Web Search** — Optional search mode for up-to-date information

### Room Booking System
- **Real-time Availability** — Check room availability instantly
- **Multiple Room Types** — Deluxe, Suite, Executive rooms with detailed info
- **Price Display** — Transparent pricing for each room category

### Beautiful UI/UX
- **Elegant Color Scheme** — Gold (#c19a6b) and deep navy (#1a2c3e) luxury palette
- **Dark/Light Mode** — Toggle between themes for user preference
- **Smooth Animations** — AOS scroll animations for engaging experience
- **Responsive Design** — Perfect on mobile, tablet, and desktop
- **Glass-morphism Effects** — Modern frosted glass UI elements
- **Typography** — Playfair Display (headings) + Inter (body) fonts

### Website Pages
- **Home** — Hero section, features, testimonials, gallery preview
- **Rooms** — All room types with images, amenities, pricing
- **Gallery** — Stunning hotel images and visual tour
- **Services** — Spa, restaurant, pool, conference facilities
- **About Us** — Hotel story and team
- **Contact** — Contact form, map, location info
- **Booking** — Complete booking flow with confirmation
- **Admin Panel** — Manage bookings and hotel data

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

1. Navigate to server directory:
   ```bash
   cd "Hotel Maxx/server"
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create environment file:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` and add your API keys:
   ```
   GEMINI_API_KEY=your_google_gemini_api_key
   # OR use legacy key:
   # LEGACY_GEMINI_KEY=your_legacy_api_key
   ```

### Running the Server

**Development mode** (with auto-reload):
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

The website will be available at: **http://localhost:3000**

## 📁 Project Structure

```
Hotel Maxx/
└── server/
    ├── public/              # Frontend files
    │   ├── index.html       # Main entry
    │   ├── home.html        # Home page
    │   ├── rooms.html       # Rooms listing
    │   ├── booking.html     # Booking page
    │   ├── gallery.html     # Photo gallery
    │   ├── contact.html     # Contact page
    │   ├── admin.html       # Admin panel
    │   ├── css/             # Stylesheets
    │   └── js/              # JavaScript files
    ├── server.js            # Express server
    ├── package.json         # Dependencies
    ├── .env.example         # Environment template
    └── README.md            # This file
```

## 🔧 Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `GEMINI_API_KEY` | Google Gemini API key (recommended) | - |
| `LEGACY_GEMINI_KEY` | Legacy API key (older keys) | - |
| `GEMINI_MODEL` | Gemini model to use | gemini-2.0-flash |
| `SERPER_API_KEY` | Serper API for web search | - |
| `ADMIN_PASSWORD` | Admin panel password | - |

## 🔐 Security Notes

- **Never commit** `.env` file — it's in `.gitignore`
- **Rotate keys** immediately if exposed
- **Use GEMINI_API_KEY** (Bearer token) over legacy keys for production
- **Restrict API keys** to your server's IP in Google Cloud Console

## 🛠️ Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Node.js, Express.js
- **AI**: Google Gemini API
- **Real-time**: Socket.io
- **Fonts**: Playfair Display, Inter (Google Fonts)
- **Icons**: Font Awesome 6.4
- **Animations**: AOS (Animate On Scroll)

---

Built with ❤️ for Hotel Maxx, Kohalpur, Nepal