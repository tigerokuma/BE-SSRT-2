
# Dependency Watchlist – Features Summary

The **Dependency Watchlist** service enables developers to evaluate and track open-source packages **before adoption**. It focuses on **searching**, **inspecting**, and **bookmarking** packages for future monitoring. CVE alerts and real-time notifications are handled by the **Alert Center**, not this service.

---

### Core Features

---

### 1. Package Discovery

**Purpose:** Help developers **search** for open-source packages by name across ecosystems like NPM or GitHub.

* Search by package name or keyword
* View quick summaries: version, downloads, and last update
* See usage badges like “Trusted by X orgs”

---

### 2. Metadata & Health Overview

**Purpose:** Provide a high-level snapshot of package **quality and health signals**.

* Display OSS Scorecard (via GitHub proxy)
* Basic release cadence and changelog
* Maintainer and contributor profiles
* Show "People also watch…" (similar packages)

---

### 3. Watchlist Management

**Purpose:** Allow developers to **track packages** of interest across projects or teams.

* Add packages to personal/team watchlist
* Group and filter packages by tags or project
* Add internal notes (e.g., “Approved for Q3 refactor”)
* View watchlist dashboard with package statuses

> Note: **This service does not send alerts.** It only tracks interest. Alert logic lives in the Alert Center.

---

### 4. GitHub Dependency Import (Passive)

**Purpose:** Automatically populate a base watchlist by **analyzing a GitHub repo’s dependencies**.

* Parse `package.json`, SBOM, or dependency files
* Manual trigger or webhook-based
* One-time or periodic syncs (passive only)

---

### 5. Developer UX Enhancements

**Purpose:** Streamline the evaluation experience through helpful context and smart defaults.

* Auto-fill common packages based on user history
* Recently viewed/search history
* Display org trust signals and related packages

---

### ❌ Out-of-Scope Features (Handled by Other Services)

| ❌ Not Handled Here               | ✅ Delegated To          |
| -------------------------------- | ----------------------- |
| CVE detection or alerting        | **Alert Center**, **Repository Activity**       |
| Real-time vulnerability scanning | **Alert Center**        |
| Commit-level analysis            | **Repository Activity** |
| User/team access control         | **GitHub teams** or something else |

---

## API Endpoints Summary

| Feature | Purpose | Flow Summary | Endpoint(s) |
|---------|---------|--------------|-------------|
| Search Packages | Allow users to find packages by name | User types package name → System fetches from cache or external API | `GET /packages/search?name=...` |
| View Package Summary | Show quick overview for decision-making | After search → Show version, downloads, last update, etc. | `GET /packages/:name/summary` |
| View Detailed Metadata | Help users assess long-term package health | Click package → Show score trends, maintainer behavior, changelog | `GET /packages/:name/details` |
| Add to Watchlist | Track packages of interest | Click "Add to Watchlist" → Store for user/team | `POST /watchlist` |
| View Watchlist | Let users view and organize their tracked packages | Open watchlist dashboard → See current status, notes, tags | `GET /watchlist` |
| Update Watchlist Notes/Tags | Help devs annotate why a package is important | Edit note or tag → Save | `PATCH /watchlist/:id` |
| GitHub Repo Dependency Import | Populate default watchlist based on actual code usage | Select repo → Parse package.json / SBOM → Add to default list | `POST /watchlist/import/github` |
| View Recently Viewed | Convenience for users evaluating multiple packages | Show user's recent search/view history | `GET /history/recent-packages` |
| Get "Trusted by X Orgs" Badge | Build confidence based on usage stats | On package summary → Show popularity marker | Included in `GET /packages/:name/summary` |
| View Similar Packages | Help users compare alternatives | On package view → Show "People also watch…" suggestions | `GET /packages/:name/similar` |

