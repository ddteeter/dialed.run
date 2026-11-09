-- The seed rows from before the squash (D-174, #506): the two migrations that
-- inserted data, verbatim, so a fresh database gets the rows the old chain
-- left. Every other INSERT or UPDATE in that chain copied or fixed rows a
-- table rebuild carried, and seeds nothing on an empty database.
--
-- Was 0002_curated_brand_seed.sql:
--
-- Curated running-brand seed (task 101). Data, not code.
--
-- This ran at runtime behind an ensureBrandsSeeded guard, firing a count
-- query on every brand-autocomplete cold path and making which-brands-exist
-- a deploy-shaped question rather than a data-shaped one.
--
-- Generated from CURATED_BRANDS with the real normalizeIdentity, so the
-- normalized column matches exactly what the app computes at query time --
-- a hand-rolled approximation here silently breaks autocomplete.
--
-- Ids are derived from the brand name rather than generated, so applying
-- this to a fresh database produces identical rows. INSERT OR IGNORE against
-- the UNIQUE(normalized) index makes it re-runnable.
INSERT OR IGNORE INTO brands (id, name, normalized, seeded) VALUES
  ('S0XG4QQ1VGTJ9RGA0XJKJFNACF', 'Nike', 'nike', 1),
  ('XTWBAMKR82A3AGGMDP9DDMA1V0', 'Adidas', 'adidas', 1),
  ('03B9KTF3SWFYX9VSDTXES6Q99D', 'Brooks', 'brooks', 1),
  ('KRZ3JQ0DX1WB6BYMP4Z7DFZHS3', 'Saucony', 'saucony', 1),
  ('4SEYTZHB31TB4RCDT44WFE31N9', 'Asics', 'asics', 1),
  ('3HAVRT4FPZ1XGS74MHMTJA4QZX', 'New Balance', 'new balance', 1),
  ('AQS27SB6BA9BTT4D2BXC754R6K', 'Hoka', 'hoka', 1),
  ('8Q1PMYFQC1YWJJT275TE2HBARP', 'On', 'on', 1),
  ('F1XTQMF6CAMWE2XBDEPWBQ8N3X', 'Altra', 'altra', 1),
  ('9D1JNV065D4B84GTC4VQN38GWY', 'Mizuno', 'mizuno', 1),
  ('R1KG2WYXA398JREK5M1C98C8TC', 'Salomon', 'salomon', 1),
  ('CP8NC8FP4T12FGEWSSWDRPPST4', 'Merrell', 'merrell', 1),
  ('WH8VGY44MYS4NFW7WKKCM0C9TP', 'Under Armour', 'under armour', 1),
  ('7BBFHD645N19C1HBYE6Y1SR11J', 'The North Face', 'the north face', 1),
  ('DFXJBP0ZZG9ER12ZVS7XTYXJ8N', 'Patagonia', 'patagonia', 1),
  ('DDZSXSVRPS9H9QRNBVZSTTDE5V', 'Arc''teryx', 'arc teryx', 1),
  ('2AVZR1N7YBCH30Z0CK0RYKWNTR', 'Rab', 'rab', 1),
  ('XDZ7GNZH9ATFP8QK04E47BV089', 'Montane', 'montane', 1),
  ('RTYPA51R8T93S8B0SXDX11NC6M', 'Craft', 'craft', 1),
  ('MDWK8MG10XJF7CCZVT03VFTB9B', 'Icebreaker', 'icebreaker', 1),
  ('TY07AFTCMG934GAYZ8WN7M677E', 'Smartwool', 'smartwool', 1),
  ('M5HQBEW32TVY6867CC7KG25JCD', 'Darn Tough', 'darn tough', 1),
  ('93KC2EPEG4W7FAZ4Z03T5FH6H6', 'Feetures', 'feetures', 1),
  ('MRPKSM0EGJ8MQR5EAKN58Y7VE5', 'Balega', 'balega', 1),
  ('0M7DPTE8GXFAT11DVGQ5E7YSGB', 'Tracksmith', 'tracksmith', 1),
  ('EDKBVQH601CK5Z0ZCRG7V0AHCG', 'Janji', 'janji', 1),
  ('G4434ZHGHJCBJGY3S5JRSKDS6E', 'Ciele Athletics', 'ciele athletics', 1),
  ('GCRWWST5JBYMBHQBDYN2VST058', 'District Vision', 'district vision', 1),
  ('HFAEQ7KSHXVGMCWB9DYEN0GQFY', 'Rabbit', 'rabbit', 1),
  ('X763X01X9GKMNPX8VAEKXNA5G7', 'Bandit Running', 'bandit running', 1),
  ('HG1PNQJ1XXQSN63PMG4HZMJ8NX', 'Satisfy', 'satisfy', 1),
  ('5ZSV1QH69J41XKWM54MQR8PPPQ', 'Soar Running', 'soar running', 1),
  ('QPN41GHAVC2SCXMFBQAB7DDATN', 'Iffley Road', 'iffley road', 1),
  ('34Q8JX7JJTHGVZ6M1C9P8BG7PX', 'Path Projects', 'path projects', 1),
  ('QX1D4EHWJTSX5ZPG30ADFP8V3X', 'Cotopaxi', 'cotopaxi', 1),
  ('YBXP3NCKQQMCZZG12AG4N94VZT', 'Outdoor Voices', 'outdoor voices', 1),
  ('4KA3050Z2Z8EN219K0B0QNT2D6', 'Lululemon', 'lululemon', 1),
  ('Z54DJMXQ1N8CNH9DXZAJBM6SEA', 'Gymshark', 'gymshark', 1),
  ('HFAKM3HP74YRWAMYK7TMC9S63B', '2XU', '2xu', 1),
  ('YK15HR5RCYW23DN23Q8MTJFPKT', 'Compressport', 'compressport', 1),
  ('9QHEMFG0QNG783PFY46H8Q8A1M', 'CEP', 'cep', 1),
  ('B9BTG77KWWYNXH7PZ2GFV2YANG', 'Injinji', 'injinji', 1),
  ('RXZ0DC338GK7GG3FXX6VEZHSB2', 'Buff', 'buff', 1),
  ('7VRA4PQPT1YP76R9NS07GNZ5Y5', 'Nathan', 'nathan', 1),
  ('QQQY3FF3252D9CTDX65AB6N1GW', 'UltrAspire', 'ultraspire', 1),
  ('DN0Q7ANCZ2ND2N971KZ4CMH6A0', 'Orange Mud', 'orange mud', 1),
  ('2550PTPT4X0FFC3DXNW9XS3HCD', 'Naked Running Band', 'naked running band', 1),
  ('S0X0MR97MQD75JGG218VAP8ZP7', 'Goodr', 'goodr', 1),
  ('VPHE574RYV774JG9C27NPHENA0', 'Oakley', 'oakley', 1),
  ('ZK205YZ48WF6MJTM6VN25HVKQW', 'Julbo', 'julbo', 1),
  ('CMESBPS9WBAQFK6S2KT8ME62N0', 'Precision Fit', 'precision fit', 1);

--> statement-breakpoint
-- Was 0078_seed_link_shortener_denylist.sql:
--
-- Link shorteners and redirectors, denied from the start (R-176, design 171).
-- Data, not code: the owner's list, answered 2026-11-05.
--
-- A link through one of these goes wherever its owner points it, and the
-- denylist checks only the link as typed and the page enrichment landed
-- on, so a runner's link through one is refused rather than trusted to
-- land somewhere allowed. Hosts like l.facebook.com deny that subdomain
-- only: the suffix rule denies what is under a row, never what is above it.
--
-- Left off on purpose: amzn.to and a.co (runners paste them for real
-- products, and enrichment checks where they land), linktr.ee (a page of
-- links, not a redirect) and google.com (its /url redirect cannot be
-- denied without denying Google).
--
-- INSERT OR IGNORE on the primary key makes it re-runnable, and leaves a
-- domain an operator already denied as they wrote it.
INSERT OR IGNORE INTO domain_denylist (domain, added_by, reason, created_at) VALUES
  ('bit.ly', 'seed', 'link shortener (R-176)', 1793836800),
  ('bitly.com', 'seed', 'link shortener (R-176)', 1793836800),
  ('tinyurl.com', 'seed', 'link shortener (R-176)', 1793836800),
  ('t.co', 'seed', 'link shortener (R-176)', 1793836800),
  ('goo.gl', 'seed', 'link shortener (R-176)', 1793836800),
  ('ow.ly', 'seed', 'link shortener (R-176)', 1793836800),
  ('buff.ly', 'seed', 'link shortener (R-176)', 1793836800),
  ('is.gd', 'seed', 'link shortener (R-176)', 1793836800),
  ('v.gd', 'seed', 'link shortener (R-176)', 1793836800),
  ('rebrand.ly', 'seed', 'link shortener (R-176)', 1793836800),
  ('cutt.ly', 'seed', 'link shortener (R-176)', 1793836800),
  ('shorturl.at', 'seed', 'link shortener (R-176)', 1793836800),
  ('rb.gy', 'seed', 'link shortener (R-176)', 1793836800),
  ('tiny.cc', 'seed', 'link shortener (R-176)', 1793836800),
  ('s.id', 'seed', 'link shortener (R-176)', 1793836800),
  ('t.ly', 'seed', 'link shortener (R-176)', 1793836800),
  ('bl.ink', 'seed', 'link shortener (R-176)', 1793836800),
  ('shorte.st', 'seed', 'link shortener (R-176)', 1793836800),
  ('adf.ly', 'seed', 'link shortener (R-176)', 1793836800),
  ('lnkd.in', 'seed', 'link shortener (R-176)', 1793836800),
  ('fb.me', 'seed', 'link shortener (R-176)', 1793836800),
  ('qr.ae', 'seed', 'link shortener (R-176)', 1793836800),
  ('l.facebook.com', 'seed', 'link redirector (R-176)', 1793836800),
  ('lm.facebook.com', 'seed', 'link redirector (R-176)', 1793836800),
  ('l.instagram.com', 'seed', 'link redirector (R-176)', 1793836800),
  ('out.reddit.com', 'seed', 'link redirector (R-176)', 1793836800),
  ('l.messenger.com', 'seed', 'link redirector (R-176)', 1793836800),
  ('href.li', 'seed', 'link redirector (R-176)', 1793836800),
  ('anon.to', 'seed', 'link redirector (R-176)', 1793836800),
  ('dereferer.org', 'seed', 'link redirector (R-176)', 1793836800),
  ('nullrefer.com', 'seed', 'link redirector (R-176)', 1793836800);
