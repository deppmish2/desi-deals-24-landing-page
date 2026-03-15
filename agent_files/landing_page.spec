Access to the 24 Deals page is gated behind Basic member status
A user reaches Basic member status by inviting 2 friends who successfully register
The 24 Deals page must feature products from a minimum of 10 shops
Not more than 3 deals from one shop.
Products must span multiple categories, with at least 80% coverage across main product categories as listed in /Users/depppmish/Desktop/desi-deals-deepak-fork/desi-deals-24/data/Most Popular Indian Groceries - indian_grocery_1000_items.csv
The 24 deals are fixed for the day (no intra-day changes)
In the 24 deals showpage, do not use more than 4 "Best before xxDATEXX" 
No product repeats across any rolling 7-day window
Deals displayed on the landing page must be live and active at the time of viewing
Landing page deals are sourced directly from the daily deals pool (no separate curation)

Add a countdown timer to the next 07:00 refresh (e.g. "New deals in 04:32:10") .
Clicking a deal card redirects to the store page
Include a feedback mechanism for users to submit feedback directly from the page

Waitlist Landing Page
Display store names blurred on deal cards, only for waitlist page

24 Deals Page — UI
Use a €50 note image as the hero image

Referral
If a person has already registered by email that the user sends referral to, 
do not count it as unlock progress because the 
person (email) is already on our platform.
check(db users) this before adding into friends registered.


Redirect once the user has unlocked 2 firends registration he should be sent to 
https://desideals24.com/24deals not to https://desideals24.com/waitlist anymore.
