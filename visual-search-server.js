require('dotenv').config();
const express = require('express');
const visualSearch = require('./routes/visual-search');
const orderTracking = require('./routes/order-tracking');
const backInStock = require('./routes/back-in-stock');

const app = express();
app.set('trust proxy', 1);            // correct client IP behind Render/Railway/Cloudflare

app.get('/', (_req, res) => res.send('Visual search backend is running'));
app.use(visualSearch);
app.use(orderTracking); 
app.use(backInStock);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Visual search backend running on port ${PORT}`));
