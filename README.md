# Good Cut — barber booking site

The site uses plain HTML, CSS, and JavaScript for the front end, with a small Node.js server and MongoDB for appointment data. The website and admin pages are in Azerbaijani.

The public HTML, CSS, and browser JavaScript files are in `public/`. The Express server and API are in `server.js`. `vercel.json` selects the Express preset and maps the admin URLs to their static pages on Vercel.

## Connect your MongoDB Atlas cluster

1. In Atlas, open your cluster and choose **Connect → Drivers → Node.js**. Copy the connection string.
2. In Atlas **Security → Database & Network Access**, create a database user and add your current public IP address to the IP access list. Use a narrowly scoped IP entry for development rather than allowing access from every address.
3. In this project folder, make a private `.env` file by copying `.env.example`.
4. Open `.env` and replace `MONGODB_URI` with the Atlas connection string. Replace the username/password placeholders Atlas provides; URL-encode special characters in the password. Keep `MONGODB_DB=good_cut` unless you want a different database name.
5. Replace `SESSION_SECRET`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` with private values. Do not share them or commit `.env`.
6. In a terminal opened in this project folder, run `npm install` once and then `npm start`.
7. Open `http://localhost:3000` for the site and `http://localhost:3000/admin` for the staff appointments page.

Atlas requires both a database user and an allowed IP address before the app can connect. Atlas's **Drivers** connection string is intended for an application; if your password contains reserved URL characters, encode them before putting the URI in `.env`.


## Cloudinary image uploads

The admin photo pickers upload images directly from a phone or computer to Cloudinary using a short-lived server-generated signature. The Cloudinary API secret stays in server environment variables and is never sent to the browser.

1. Create a Cloudinary account and copy the cloud name, API key, and API secret from **Console Settings → API Keys**.
2. Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in the local `.env` file for local use.
3. Add the same three variables to the Vercel project's Environment Variables, then redeploy. Keep the API secret private.
4. Open `/admin/barbers` to replace profile photos, or `/admin/content` to replace the homepage and gallery photos. The picker supports images up to 10 MB.

## Email notifications (optional for now)

Appointments are saved and confirmed even while SMTP settings are blank. Add your email provider's SMTP host, port, username, password, and sender address to `.env` to send booking and cancellation notices.

## Editable shop placeholders

Placeholder services, prices, durations, and default barber data are defined in `config/business.js`. Staff can update weekly opening hours, barber profiles and photos, services and prices per barber, and the Azerbaijani About section and site photos from the admin pages. Changes are saved in MongoDB. The initial services are copied to each barber the first time the updated app starts; later edits are preserved.

The booking calendar checks live appointments and staff blocks. Staff share the username/password in `.env`. The admin pages are `/admin/appointments`, `/admin/services`, `/admin/barbers`, `/admin/hours`, `/admin/blocks`, and `/admin/content`; `/admin` opens appointments by default. Archived barbers are removed from the public roster and new booking choices while their records and past appointments remain in MongoDB. Booking is confirmed immediately when the slot is available.
