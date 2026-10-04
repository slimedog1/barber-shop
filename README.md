# Good Cut — barber booking site

The site uses plain HTML, CSS, and JavaScript for the front end, with a small Node.js server and MongoDB for appointment data. Azerbaijani is the default language; Russian and English are also available.

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

## Email notifications (optional for now)

Appointments are saved and confirmed even while SMTP settings are blank. Add your email provider's SMTP host, port, username, password, and sender address to `.env` to send booking and cancellation notices.

## Editable shop placeholders

Placeholder services, prices, durations, and default barber data are defined in `config/business.js`. Staff can update weekly opening hours and barber names, roles, and active status from the admin pages; those changes are saved in MongoDB and remain after a server restart. Default catalog data is only inserted into an empty database. Barber photo editing is not part of the admin workflow yet.

The booking calendar checks live appointments and staff blocks. Staff share the username/password in `.env`. The admin pages are `/admin/appointments`, `/admin/hours`, `/admin/barbers`, and `/admin/blocks`; `/admin` opens appointments by default. Archived barbers are removed from the public roster and new booking choices while their records and past appointments remain in MongoDB. Booking is confirmed immediately when the slot is available.
