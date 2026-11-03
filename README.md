# 🏸 Badminton Round Robin Tournament Dashboard

A modern, fast, mobile-responsive interactive web dashboard built to manage and track doubles badminton round-robin tournaments.

---

## 🌟 Key Features

1. **🏆 Tournament Leaderboards**:
   - **Individual Players Leaderboard**: Ranked by matches won, then fewest losses, with win percentage, total points scored, average points per match, and matches remaining. Sortable by Wins, Win %, Points, and Average.
   - **Pairs Leaderboard**: Complete statistics for every doubles duo (45 pairs for 10 players).
   
2. **🎯 Court Matchup Finder (4-Player Selector)**:
   - Select any 4 players who showed up on court.
   - Instantly calculates the **3 distinct doubles combinations**:
     - `(A & B) vs (C & D)`
     - `(A & C) vs (B & D)`
     - `(A & D) vs (B & C)`
   - Displays how many games have been played, exact scores, and directly surfaces **pending games** with a one-click score recorder.

3. **👥 Players & Dynamic Roster Addition**:
   - View complete player profiles and partnership breakdowns.
   - **Add New Player**: Automatically generates and schedules all new round-robin doubles matchups with existing players.

4. **📋 Master Fixture List & Score Recorder**:
   - Browse all 630+ matchups.
   - Filter by *Pending Games*, *In Progress*, or *Completed*.
   - In-modal score recorder that immediately updates standings in real time.

5. **💾 Data Persistence & Portability**:
   - Stores updates automatically in browser `localStorage`.
   - **Export / Import**: One-click JSON backup and restore so anyone can share or load the tournament state on mobile or desktop.

---

## 🚀 How to Host on Free Tier Services

Because this portal is built with pure web standards (HTML5, modern CSS3, and JavaScript), it requires **zero backend build steps or server maintenance**, making it 100% free to host anywhere.

### Option 1: GitHub Pages (Recommended - 1 minute setup)
1. Initialize a repository and push this folder to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit for badminton dashboard"
   git branch -M main
   git remote add origin https://github.com/<YOUR_USERNAME>/<REPO_NAME>.git
   git push -u origin main
   ```
2. In your GitHub repository:
   - Go to **Settings** > **Pages**
   - Under **Build and deployment**, select `Deploy from a branch`
   - Select branch `main` and folder `/ (root)`, then click **Save**.
3. Your site will be live at `https://<YOUR_USERNAME>.github.io/<REPO_NAME>/`!

### Option 2: Netlify (Drag & Drop or Git)
1. Go to [Netlify Drop](https://app.netlify.com/drop).
2. Drag and drop this folder (`Badminton Round Robin Tracker`).
3. You immediately get a free, live public URL (e.g., `https://my-badminton-dashboard.netlify.app`).

### Option 3: Vercel
1. Install Vercel CLI or import via GitHub on [vercel.com](https://vercel.com).
2. Click **Deploy** (zero config required).

---

## 💻 Running Locally

You can open `index.html` directly in any web browser:
- Double click [`index.html`](file:///Users/ananthsrivalli/Downloads/Badminton%20Round%20Robin%20Tracker/index.html), or
- Run a simple local server:
  ```bash
  python3 -m http.server 8080
  ```
  and visit `http://localhost:8080`.

