# 🚀 KTP Interflex – Online zetten: Stap-voor-stap handleiding

Geschatte tijd: **30-45 minuten** (eenmalig)
Kosten: **€0** (alles gratis)

---

## STAP 1 – Supabase database aanmaken

1. Ga naar **https://supabase.com** en klik op "Start your project"
2. Log in met Google of maak een account aan
3. Klik op **"New project"**
4. Vul in:
   - **Name:** `ktp-woningbeheer`
   - **Database password:** Bedenk een sterk wachtwoord (sla dit op!)
   - **Region:** `West EU (Ireland)` of `Central EU (Frankfurt)`
5. Klik op **"Create new project"** — wacht ~2 minuten

### Database tabellen aanmaken:
6. Ga in je project naar **SQL Editor** (linker menu)
7. Klik op **"New query"**
8. Open het bestand `supabase_setup.sql` uit de projectmap
9. Kopieer de volledige inhoud en plak het in de SQL editor
10. Klik op **"Run"** (groene knop)
    → Je ziet: "Success. No rows returned"

### Je API sleutels ophalen:
11. Ga naar **Settings** (tandwiel, linker menu) → **API**
12. Noteer:
    - **Project URL** (begint met `https://`)
    - **anon public** key (lange tekst onder "Project API keys")

---

## STAP 2 – Code uploaden naar GitHub

1. Ga naar **https://github.com** en maak een gratis account
2. Klik op **"New repository"** (groene knop)
3. Naam: `ktp-woningbeheer`
4. Laat alles op default staan en klik **"Create repository"**

### Bestanden uploaden:
5. Klik op **"uploading an existing file"**
6. Sleep de hele **`ktp-woningbeheer` map** naar het uploadvenster
   (of upload de bestanden één voor één)
7. Klik **"Commit changes"**

---

## STAP 3 – .env bestand instellen (je geheime sleutels)

Voordat je deployt, moet je de Supabase URL en sleutel toevoegen.

In de GitHub repository:
1. Klik op **"Add file"** → **"Create new file"**
2. Noem het bestand: `.env.local`
3. Vul in (vervang met jouw gegevens uit Stap 1):
```
REACT_APP_SUPABASE_URL=https://JOUW-PROJECT-ID.supabase.co
REACT_APP_SUPABASE_ANON_KEY=JOUW-ANON-KEY-HIER
```
4. Klik **"Commit changes"**

> ⚠️ Let op: `.env.local` staat in `.gitignore` — voor Vercel stel je deze variabelen apart in (zie Stap 4)

---

## STAP 4 – Deployen via Vercel

1. Ga naar **https://vercel.com** en klik "Sign Up"
2. Kies **"Continue with GitHub"** — geef toegang
3. Klik op **"Add New Project"**
4. Zoek je repository `ktp-woningbeheer` en klik **"Import"**
5. Framework: laat staan op **"Create React App"**

### Omgevingsvariabelen toevoegen:
6. Klik op **"Environment Variables"** (uitklappen)
7. Voeg toe:
   - **Name:** `REACT_APP_SUPABASE_URL`  
     **Value:** `https://JOUW-PROJECT-ID.supabase.co`
   - **Name:** `REACT_APP_SUPABASE_ANON_KEY`  
     **Value:** `JOUW-ANON-KEY`
8. Klik **"Deploy"**
9. Wacht ~2 minuten...

✅ **Je app is online!** Vercel geeft je een link zoals:  
`https://ktp-woningbeheer.vercel.app`

---

## STAP 5 – Eigen domeinnaam (optioneel)

Wil je een mooiere link zoals `woningen.ktp-interflex.nl`?

1. In Vercel → jouw project → **Settings** → **Domains**
2. Klik **"Add"** en vul je gewenste domeinnaam in
3. Vercel legt uit welke DNS-instellingen je bij je domeinnaamregistrar moet instellen

---

## STAP 6 – Realtime aanzetten in Supabase

Voor live updates (zodat iedereen meteen wijzigingen ziet):

1. Ga in Supabase naar **Database** → **Replication**
2. Zorg dat `woningen` en `meldingen` aangevinkt zijn onder "Source"
3. Dit is normaal al goed ingesteld na het uitvoeren van de SQL

---

## 🔁 App updaten in de toekomst

Als je de code wilt aanpassen:
1. Pas de bestanden aan in GitHub (klik op een bestand → potloodicoontje)
2. Klik "Commit changes"
3. Vercel detecteert dit automatisch en deployt de nieuwe versie binnen 2 minuten

---

## 📱 Delen met collega's

Stuur de Vercel-link naar je collega's:
- Op telefoon: link in browser openen → "Toevoegen aan beginscherm" = werkt als een app
- Op computer: gewoon de link bookmarken

**Toegang:**
- Iedereen met de link kan inloggen (geen apart wachtwoord nodig)
- Rollen worden gekozen bij inloggen (Collega / Huismeester / Backoffice)
- Wil je rollen beveiligen met een wachtwoord? Dat kan later worden toegevoegd

---

## ❓ Hulp nodig?

Kom je ergens niet uit? Stel je vraag in Claude met een screenshot van waar je vastloopt!
