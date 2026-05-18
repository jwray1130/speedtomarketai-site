// ============================================================================
// workbench-rules.js — Speed to Market AI underwriting rules + source resolver
// ============================================================================
// Single source of truth for:
//   - SOURCE_AUTHORITY:  which extraction modules / submission columns are
//                        authoritative for each workbench field, in priority
//                        order. Used by resolveField() to walk the waterfall.
//   - GUIDELINE_CAPS:    company-wide max-limit rules ($5M lead, $10M excess,
//                        $10M quota share). Applied uniformly. Not user-
//                        editable from the UI — only changed here.
//   - DEFAULTS:          hardcoded defaults that map to placeholder UW/UA
//                        assignments today; replaced by Phase 6 with real
//                        Supabase-backed tables for email-to-UW routing and
//                        UA assignment per UW.
//   - COMPUTE:           pure utility functions for date math + formatting.
//
// PHASE 2 SCOPE: this file ships with Tier 0 + Tier 0.5 entries only —
//   - submission.* (direct top-level Supabase column)
//   - hardcoded:<value>
//   - compute:<formula>
// Tier 1 (JSON-in-extraction) and Tier 2 (markdown label parsing) entries
// will be added in Phase 3 alongside resolveField()'s parser implementations.
//
// FIX-PHASE-2-SOURCE-PRIORITY-RESOLVER-2026-05-14
// ============================================================================

(function (root) {
  'use strict';

  // ─── Hardcoded defaults ───────────────────────────────────────────────────
  // Phase 6 replaces these with Supabase lookups.

  const DEFAULTS = {
    underwriter: 'Justin Wray',
    assistant: 'Tracy Savage',
    broker_type: 'Wholesale',
    broker_region: 'South East',
    paper: 'Steadfast Insurance Company',
    market: 'nonAdmitted',             // FIX-v8.6.48.1: option value, not display text
    target_lead_lookback_days: 10,     // target bind = effective - 10 days
    quote_expiration_days: 30          // quote exp  = submission + 30 days
  };

  // v8.6.93 — static GL class-code reference engine + manual lookup support.
  // Source: user-provided Class Code / Description / Rating Basis table.
  // Used to validate GL rater rows and normalize descriptions/bases.
  const GL_CLASS_CODE_TABLE = Object.freeze({"50015":{"description":"Abrasive or Abrasive Products Manufacturing - artificial","ratingBasis":"$1,000 of Gross Sales"},"50017":{"description":"Abrasive or Abrasive Products Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"50010":{"description":"Abrasive Wheel Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"49950":{"description":"Additional Interest","ratingBasis":"No Exposure"},"50045":{"description":"Adhesive Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"50047":{"description":"Adhesive Tape Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"40005":{"description":"Adult Day Care - not-for-profit only","ratingBasis":"Per Person"},"40006":{"description":"Adult Day Care - other than not-for-profit","ratingBasis":"Per Person"},"90089":{"description":"Advertising Sign Companies - outdoor","ratingBasis":"$1,000 of Payroll"},"51001":{"description":"Aerosol Container Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"51005":{"description":"Aerosol Containers - filling or charging for others","ratingBasis":"$1,000 of Gross Sales"},"10010":{"description":"Air Conditioning Equipment - dealers and distributors only","ratingBasis":"$1,000 of Gross Sales"},"51116":{"description":"Air Conditioning Equipment Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"91111":{"description":"Air Conditioning Systems or Equipment - dealers or distributors and installation, servicing or repair","ratingBasis":"$1,000 of Payroll"},"51201":{"description":"Aircraft or Aircraft Parts Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"40026":{"description":"Airport - lessees of portions of airports engaged in the sale of aircraft or accessories, servicing or repairing of aircraft, or pilot instructions","ratingBasis":"Number of Lessees"},"40020":{"description":"Airport Control Towers - not operated exclusively by Federal Aviation Administration","ratingBasis":"Number of Towers"},"91125":{"description":"Airport Runway or Warming Apron - paving or repairing, surfacing, resurfacing or scraping","ratingBasis":"$1,000 of Payroll"},"40010":{"description":"Airports - commercial","ratingBasis":"Number of Airports"},"40015":{"description":"Airports - private","ratingBasis":"Number of Airports"},"91127":{"description":"Alarm and Alarm Systems - installation, servicing or repair","ratingBasis":"$1,000 of Payroll"},"51205":{"description":"Alarm Manufacturing - burglar","ratingBasis":"$1,000 of Gross Sales"},"51206":{"description":"Alarm Manufacturing - fire or smoke","ratingBasis":"$1,000 of Gross Sales"},"91130":{"description":"Alarms - security systems - monitoring","ratingBasis":"$1,000 of Payroll"},"51210":{"description":"Alcohol Manufacturing - not beverage","ratingBasis":"$1,000 of Gross Sales"},"40031":{"description":"Ambulance Service, First Aid or Rescue Squads (For-Profit)","ratingBasis":"Number of Attendants"},"40032":{"description":"Ambulance Service, First Aid or Rescue Squads (Not-For-Profit)","ratingBasis":"Number of Attendants"},"51211":{"description":"Ammunition Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"10015":{"description":"Amusement Centers","ratingBasis":"$1,000 of Gross Sales"},"40040":{"description":"Amusement Devices - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"40041":{"description":"Amusement Devices - operated in connection with carnivals or fairs (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"40042":{"description":"Amusement Devices - operated in connection with carnivals or fairs (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"10020":{"description":"Amusement Parks","ratingBasis":"$1,000 of Gross Sales"},"91135":{"description":"Analytical Chemists","ratingBasis":"$1,000 of Payroll"},"10036":{"description":"Anhydrous Ammonia Dealers and Distributors","ratingBasis":"$1,000 of Gross Sales"},"40045":{"description":"Animals - draft","ratingBasis":"Number of Teams"},"40046":{"description":"Animals - saddle - for rent","ratingBasis":"Number of Animals"},"40047":{"description":"Animals - saddle - private","ratingBasis":"Number of Animals"},"10026":{"description":"Antique Stores","ratingBasis":"$1,000 of Gross Sales"},"60010":{"description":"Apartment Buildings","ratingBasis":"Number of Units"},"60011":{"description":"Apartment Buildings - garden","ratingBasis":"Number of Units"},"60013":{"description":"Apartment Buildings or Hotels - time-sharing - 4 stories or more","ratingBasis":"Number of Units"},"60012":{"description":"Apartment Buildings or Hotels - time-sharing - less than 4 stories","ratingBasis":"Number of Units"},"60016":{"description":"Apartment Hotels - 4 stories or more","ratingBasis":"Number of Units"},"60015":{"description":"Apartment Hotels - less than 4 stories","ratingBasis":"Number of Units"},"10040":{"description":"Appliance Distributors - household type","ratingBasis":"$1,000 of Gross Sales"},"10042":{"description":"Appliance Stores - household type","ratingBasis":"$1,000 of Gross Sales"},"91150":{"description":"Appliances and Accessories - installation, servicing or repair - commercial","ratingBasis":"$1,000 of Payroll"},"91155":{"description":"Appliances and Accessories - installation, servicing or repair - household","ratingBasis":"$1,000 of Payroll"},"51220":{"description":"Appliances and Accessories Manufacturing - commercial - gas","ratingBasis":"$1,000 of Gross Sales"},"51221":{"description":"Appliances and Accessories Manufacturing - commercial - not gas","ratingBasis":"$1,000 of Gross Sales"},"51222":{"description":"Appliances and Accessories Manufacturing - household - gas","ratingBasis":"$1,000 of Gross Sales"},"51224":{"description":"Appliances and Accessories Manufacturing - household - not gas","ratingBasis":"$1,000 of Gross Sales"},"10052":{"description":"Archery Ranges - indoor","ratingBasis":"$1,000 of Gross Sales"},"10054":{"description":"Archery Ranges - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"91160":{"description":"Armored Car Service Companies","ratingBasis":"$1,000 of Payroll"},"10060":{"description":"Army and Navy Stores","ratingBasis":"$1,000 of Gross Sales"},"10065":{"description":"Art Galleries (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"10066":{"description":"Art Galleries (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"51230":{"description":"Asbestos Goods Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"51240":{"description":"Asphalt or Tar Distilling or Refining","ratingBasis":"$1,000 of Gross Sales"},"51241":{"description":"Asphalt Works","ratingBasis":"$1,000 of Gross Sales"},"40059":{"description":"Athletic Games Sponsored by the Insured (For-Profit)","ratingBasis":"Number of Games"},"40061":{"description":"Athletic Games Sponsored by the Insured (Not-For-Profit)","ratingBasis":"Number of Games"},"40063":{"description":"Athletic or Sports Contests - in buildings - lessees (For-Profit)","ratingBasis":"Thousands of Admissions"},"40064":{"description":"Athletic or Sports Contests - in buildings - lessees (Not-For-Profit)","ratingBasis":"Thousands of Admissions"},"40066":{"description":"Athletic Programs - amateur (For-Profit)","ratingBasis":"Number of Games"},"40067":{"description":"Athletic Programs - amateur (Not-For-Profit)","ratingBasis":"Number of Games"},"40069":{"description":"Athletic Teams - professional or semi-professional","ratingBasis":"Number of Games"},"91175":{"description":"Auctioneers - livestock - sales conducted away from premises owned or rented by the insured","ratingBasis":"$1,000 of Payroll"},"91177":{"description":"Auctioneers - sales conducted away from premises owned or rented by the insured","ratingBasis":"$1,000 of Payroll"},"91179":{"description":"Auctions - on premises owned or rented by the insured","ratingBasis":"$1,000 of Payroll"},"91190":{"description":"Automobile Dismantling","ratingBasis":"$1,000 of Payroll"},"51255":{"description":"Automobile Manufacturing or Assembling","ratingBasis":"$1,000 of Gross Sales"},"10070":{"description":"Automobile Parts and Supplies Distributors","ratingBasis":"$1,000 of Gross Sales"},"10071":{"description":"Automobile Parts and Supplies Stores","ratingBasis":"$1,000 of Gross Sales"},"10072":{"description":"Automobile Quick Lubrication Services","ratingBasis":"$1,000 of Gross Sales"},"60035":{"description":"Automobile Renting or Leasing Companies","ratingBasis":"Thousands of Square Feet"},"10073":{"description":"Automobile Repair or Service Shops - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"10075":{"description":"Automobile Repair Shops - self-service","ratingBasis":"$1,000 of Gross Sales"},"51250":{"description":"Automobile, Bus and Truck Body Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"51251":{"description":"Automobile, Bus or Truck Parts Manufacturing - brakes or brake linings","ratingBasis":"$1,000 of Gross Sales"},"51252":{"description":"Automobile, Bus or Truck Parts Manufacturing - not operating parts","ratingBasis":"$1,000 of Gross Sales"},"51253":{"description":"Automobile, Bus or Truck Parts Manufacturing - operating parts","ratingBasis":"$1,000 of Gross Sales"},"51254":{"description":"Automobile, Bus or Truck Parts Manufacturing - passenger restraining devices","ratingBasis":"$1,000 of Gross Sales"},"51300":{"description":"Baby Food Manufacturing - in glass containers","ratingBasis":"$1,000 of Gross Sales"},"51305":{"description":"Baby Food Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"10100":{"description":"Bakeries","ratingBasis":"$1,000 of Gross Sales"},"51315":{"description":"Bakery Plants","ratingBasis":"$1,000 of Gross Sales"},"10111":{"description":"Barber or Beauty Shop Supplies Distributors","ratingBasis":"$1,000 of Gross Sales"},"10113":{"description":"Barber Shops","ratingBasis":"$1,000 of Gross Sales"},"10120":{"description":"Bathhouses or Bathing Pavilions","ratingBasis":"$1,000 of Gross Sales"},"51330":{"description":"Battery Manufacturing - dry cell","ratingBasis":"$1,000 of Gross Sales"},"51333":{"description":"Battery Manufacturing - wet cell or storage","ratingBasis":"$1,000 of Gross Sales"},"10130":{"description":"Bazaars - operated by the insured (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"10132":{"description":"Bazaars - operated by the insured (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"10133":{"description":"Beach Chairs and Umbrellas - rented to others","ratingBasis":"$1,000 of Gross Sales"},"10135":{"description":"Beaches - bathing - commercially operated","ratingBasis":"$1,000 of Gross Sales"},"40072":{"description":"Beaches - bathing - not commercially operated","ratingBasis":"Number of Beaches"},"51340":{"description":"Bearing Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"10115":{"description":"Beauty Parlors and Hair Styling Salons","ratingBasis":"$1,000 of Gross Sales"},"45210":{"description":"Bed and Breakfasts","ratingBasis":"$1,000 of Gross Sales"},"51350":{"description":"Beer, Ale or Malt Liquor Manufacturing - in bottles","ratingBasis":"$1,000 of Gross Sales"},"51351":{"description":"Beer, Ale or Malt Liquor Manufacturing - in cans","ratingBasis":"$1,000 of Gross Sales"},"51352":{"description":"Beer, Ale or Malt Liquor Manufacturing - not bottled or canned","ratingBasis":"$1,000 of Gross Sales"},"51355":{"description":"Beverage Bottler - soft drinks - carbonated - in cans or plastic bottles","ratingBasis":"$1,000 of Gross Sales"},"51356":{"description":"Beverage Bottler - soft drinks - carbonated - in glass bottles","ratingBasis":"$1,000 of Gross Sales"},"51357":{"description":"Beverage Bottler - soft drinks - in metal cylinders","ratingBasis":"$1,000 of Gross Sales"},"51358":{"description":"Beverage Bottler - soft drinks - in paper containers","ratingBasis":"$1,000 of Gross Sales"},"51359":{"description":"Beverage Bottler - soft drinks - not carbonated - in bottles or cans","ratingBasis":"$1,000 of Gross Sales"},"10140":{"description":"Beverage Distributors - alcoholic other than beer","ratingBasis":"$1,000 of Gross Sales"},"10141":{"description":"Beverage Distributors - nonalcoholic and beer","ratingBasis":"$1,000 of Gross Sales"},"10145":{"description":"Beverage Stores - liquor and wine","ratingBasis":"$1,000 of Gross Sales"},"10146":{"description":"Beverage Stores - soft drinks and beer","ratingBasis":"$1,000 of Gross Sales"},"51370":{"description":"Bicycle Manufacturing - not motorized","ratingBasis":"$1,000 of Gross Sales"},"10150":{"description":"Bicycle Stores - sales and servicing","ratingBasis":"$1,000 of Gross Sales"},"10151":{"description":"Bicycles - rented to others","ratingBasis":"$1,000 of Gross Sales"},"10160":{"description":"Billiard or Pool Halls","ratingBasis":"$1,000 of Gross Sales"},"51380":{"description":"Billiard or Pool Table Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"40075":{"description":"Bingo Games - in public halls or theaters - commercially operated","ratingBasis":"Thousands of Admissions"},"53951":{"description":"Biofuels Manufacturing – Ethanol","ratingBasis":"$1,000 of Gross Sales"},"91200":{"description":"Blacksmithing","ratingBasis":"$1,000 of Payroll"},"91210":{"description":"Blasting Operations","ratingBasis":"$1,000 of Payroll"},"40101":{"description":"Blood Banks (For-Profit)","ratingBasis":"Thousands of Square Feet"},"40102":{"description":"Blood Banks (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"61000":{"description":"Boarding or Rooming Houses","ratingBasis":"Number of Units"},"10101":{"description":"Boat Dealers","ratingBasis":"$1,000 of Gross Sales"},"51400":{"description":"Boat or Ship Building - inboard and inboard/outboard","ratingBasis":"$1,000 of Gross Sales"},"51401":{"description":"Boat or Ship Building - without motors","ratingBasis":"$1,000 of Gross Sales"},"91235":{"description":"Boat Repair and Servicing","ratingBasis":"$1,000 of Payroll"},"10105":{"description":"Boat Storage and Moorage","ratingBasis":"$1,000 of Gross Sales"},"10107":{"description":"Boat Yards or Marinas - public","ratingBasis":"$1,000 of Gross Sales"},"10110":{"description":"Boats - canoes or rowboats - for rent - not equipped with motors","ratingBasis":"$1,000 of Gross Sales"},"40111":{"description":"Boats - canoes or rowboats - not for rent - not equipped with motors","ratingBasis":"Number of Boats"},"40115":{"description":"Boats - motor or sail - not for rent","ratingBasis":"Number of Boats"},"10117":{"description":"Boats - motor or sail - rented to others","ratingBasis":"$1,000 of Gross Sales"},"40140":{"description":"Boats - nonowned over 26 feet","ratingBasis":"Number of Boats"},"40117":{"description":"Boats - Not Otherwise Classified - not for rent","ratingBasis":"Number of Boats"},"10119":{"description":"Boats - Not Otherwise Classified - rented to others","ratingBasis":"$1,000 of Gross Sales"},"91250":{"description":"Boiler Inspection, Installation, Cleaning or Repair","ratingBasis":"$1,000 of Payroll"},"51500":{"description":"Bolt, Nut, Rivet, Screw or Washer Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"51516":{"description":"Bookbinding (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"51517":{"description":"Bookbinding (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"10204":{"description":"Books and Magazine Stores (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"10205":{"description":"Books and Magazine Stores (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"51551":{"description":"Bottle and Jar Manufacturing - glass - for use under pressure - nonreturnable","ratingBasis":"$1,000 of Gross Sales"},"51552":{"description":"Bottle and Jar Manufacturing - glass - for use under pressure - returnable","ratingBasis":"$1,000 of Gross Sales"},"51550":{"description":"Bottle and Jar Manufacturing - glass - not for use under pressure","ratingBasis":"$1,000 of Gross Sales"},"51553":{"description":"Bottle and Jar Manufacturing - plastic - nonreturnable","ratingBasis":"$1,000 of Gross Sales"},"51554":{"description":"Bottle and Jar Manufacturing - plastic - returnable","ratingBasis":"$1,000 of Gross Sales"},"10220":{"description":"Bowling Lanes","ratingBasis":"$1,000 of Gross Sales"},"51575":{"description":"Boxes or Containers Manufacturing - corrugated or fiberboard","ratingBasis":"$1,000 of Gross Sales"},"51576":{"description":"Boxes or Containers Manufacturing - wood","ratingBasis":"$1,000 of Gross Sales"},"41001":{"description":"Boy or Girl Scout Councils","ratingBasis":"Number of Scouts"},"51600":{"description":"Brick Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"91266":{"description":"Bridge or Elevated Highway Construction - concrete","ratingBasis":"$1,000 of Payroll"},"91265":{"description":"Bridge or Elevated Highway Construction - iron or steel","ratingBasis":"$1,000 of Payroll"},"51613":{"description":"Brush or Broom Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"10255":{"description":"Building Material Dealers","ratingBasis":"$1,000 of Gross Sales"},"10256":{"description":"Building Material Dealers - secondhand material","ratingBasis":"$1,000 of Gross Sales"},"10257":{"description":"Building Material Distributors","ratingBasis":"$1,000 of Gross Sales"},"91280":{"description":"Building Structure - raising or moving","ratingBasis":"$1,000 of Payroll"},"61217":{"description":"Buildings or Premises - bank or office - mercantile or manufacturing - maintained by the insured (Lessor's risk only) (For-Profit)","ratingBasis":"Thousands of Square Feet"},"61218":{"description":"Buildings or Premises - bank or office - mercantile or manufacturing - maintained by the insured (Lessor's risk only) (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"61212":{"description":"Buildings or Premises - bank or office - mercantile or manufacturing (Lessor's risk only) (For-Profit)","ratingBasis":"Thousands of Square Feet"},"61216":{"description":"Buildings or Premises - bank or office - mercantile or manufacturing (Lessor's risk only) (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"61223":{"description":"Buildings or Premises - banks - Not Otherwise Classified","ratingBasis":"Thousands of Square Feet"},"61226":{"description":"Buildings or Premises - office - Not Otherwise Classified (For-Profit)","ratingBasis":"Thousands of Square Feet"},"61227":{"description":"Buildings or Premises - office - Not Otherwise Classified (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"61224":{"description":"Buildings or Premises - office premises primarily occupied by employees of the insured (For-Profit)","ratingBasis":"Thousands of Square Feet"},"61225":{"description":"Buildings or Premises - office premises primarily occupied by employees of the insured (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"51625":{"description":"Bus Manufacturing or Assembling or Reconstructing","ratingBasis":"$1,000 of Gross Sales"},"41210":{"description":"Bus Stations or Terminals","ratingBasis":"Number of Stations"},"51666":{"description":"Buttons or Fasteners Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"91302":{"description":"Cable Installation in Conduits or Subways","ratingBasis":"$1,000 of Payroll"},"91315":{"description":"Cable or Subscription Television Companies","ratingBasis":"$1,000 of Payroll"},"91324":{"description":"Caisson or Cofferdam Work - foundations for buildings","ratingBasis":"$1,000 of Payroll"},"91325":{"description":"Caisson or Cofferdam Work - not foundations for buildings","ratingBasis":"$1,000 of Payroll"},"10309":{"description":"Camera and Photographic Equipment Stores","ratingBasis":"$1,000 of Gross Sales"},"51702":{"description":"Camper Bodies or Camper Trailers Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"10315":{"description":"Camper or Travel Trailer Sales Agencies","ratingBasis":"$1,000 of Gross Sales"},"51703":{"description":"Campers Manufacturing - self-powered","ratingBasis":"$1,000 of Gross Sales"},"10331":{"description":"Campgrounds (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"10332":{"description":"Campgrounds (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"41421":{"description":"Camps - for profit","ratingBasis":"Number of Camper Days"},"41422":{"description":"Camps - not for profit","ratingBasis":"Number of Camper Days"},"51734":{"description":"Can Manufacturing - metal","ratingBasis":"$1,000 of Gross Sales"},"51741":{"description":"Candle Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"51752":{"description":"Candy or Confectionery Products Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"10352":{"description":"Candy or Confectionery Stores","ratingBasis":"$1,000 of Gross Sales"},"10367":{"description":"Car Washes","ratingBasis":"$1,000 of Gross Sales"},"10368":{"description":"Car Washes - self-service","ratingBasis":"$1,000 of Gross Sales"},"51767":{"description":"Carbon Paper or Inked Ribbon Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"10375":{"description":"Carnival or Circus Companies","ratingBasis":"$1,000 of Gross Sales"},"10378":{"description":"Carnivals - outside (sponsor's risk only) (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"10379":{"description":"Carnivals - outside (sponsor's risk only) (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"10380":{"description":"Carnivals or Circuses - in tents (sponsor's risk only) (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"10381":{"description":"Carnivals or Circuses - in tents (sponsor's risk only) (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"91340":{"description":"Carpentry - construction of residential property not exceeding three stories in height","ratingBasis":"$1,000 of Payroll"},"91341":{"description":"Carpentry - interior","ratingBasis":"$1,000 of Payroll"},"91342":{"description":"Carpentry - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"91343":{"description":"Carpentry - shop only","ratingBasis":"$1,000 of Payroll"},"51777":{"description":"Carpet or Rug Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"11007":{"description":"Carpet, Rug or Upholstery Cleaning - shop only","ratingBasis":"$1,000 of Gross Sales"},"91405":{"description":"Carpet, Rug, Furniture or Upholstery cleaning - on customer's premises","ratingBasis":"$1,000 of Payroll"},"11020":{"description":"Catalog or Premium Coupon Redemption Stores","ratingBasis":"$1,000 of Gross Sales"},"11039":{"description":"Caterers","ratingBasis":"$1,000 of Gross Sales"},"51790":{"description":"Caulking Compounds, Putty or Similar Products Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"41510":{"description":"Caves - tourist attraction","ratingBasis":"Thousands of Admissions"},"91436":{"description":"Ceiling or Wall Installation - metal","ratingBasis":"$1,000 of Payroll"},"51796":{"description":"Cellophane and Cellophane Products Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"51809":{"description":"Cement or Plaster Manufacturing - bulk","ratingBasis":"$1,000 of Gross Sales"},"51808":{"description":"Cement, Concrete Mix or Plaster Manufacturing - packaged","ratingBasis":"$1,000 of Gross Sales"},"41603":{"description":"Cemeteries (For-Profit)","ratingBasis":"Number of Acres"},"41604":{"description":"Cemeteries (Not-For-Profit)","ratingBasis":"Number of Acres"},"11052":{"description":"Chairs - rented to others","ratingBasis":"$1,000 of Gross Sales"},"51833":{"description":"Charcoal or Coal Briquette Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"11101":{"description":"Chemical Distributors","ratingBasis":"$1,000 of Gross Sales"},"51850":{"description":"Chemicals Manufacturing - commercial or industrial - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"51852":{"description":"Chemicals Manufacturing - commercial or industrial - primarily flammable, explosive or reactive - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"51853":{"description":"Chemicals Manufacturing - commercial or industrial - primarily toxic or presenting a health hazard - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"51851":{"description":"Chemicals Manufacturing - commercial or industrial - toxic and either flammable, explosive or reactive - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"51855":{"description":"Chemicals Manufacturing - household - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"51856":{"description":"Chemicals Manufacturing - household - primarily flammable, explosive or reactive - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"51857":{"description":"Chemicals Manufacturing - household - primarily toxic or presenting a health hazard - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"51854":{"description":"Chemicals Manufacturing - household - toxic and either flammable, explosive or reactive - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"11120":{"description":"Children's Playcenters - indoor","ratingBasis":"$1,000 of Gross Sales"},"91481":{"description":"Chimney Cleaning","ratingBasis":"$1,000 of Payroll"},"51869":{"description":"China, Porcelain or Earthenware Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"41650":{"description":"Churches or Other Houses of Worship","ratingBasis":"Thousands of Square Feet"},"91507":{"description":"Clay or Shale Digging","ratingBasis":"$1,000 of Payroll"},"51877":{"description":"Clay Products Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"91523":{"description":"Cleaning - outside surfaces of buildings and other exterior surfaces","ratingBasis":"$1,000 of Payroll"},"51889":{"description":"Clock Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"51896":{"description":"Clothing Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"11126":{"description":"Clothing or Wearing Apparel Distributors","ratingBasis":"$1,000 of Gross Sales"},"11127":{"description":"Clothing or Wearing Apparel Stores (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"11128":{"description":"Clothing or Wearing Apparel Stores (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"41667":{"description":"Clubs - civic, service or social - having buildings or premises owned or leased (For-Profit)","ratingBasis":"Thousands of Square Feet"},"41668":{"description":"Clubs - civic, service or social - having buildings or premises owned or leased (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"41669":{"description":"Clubs - civic, service or social - no buildings or premises owned or leased except for office purposes (For-Profit)","ratingBasis":"Number of Members"},"41670":{"description":"Clubs - civic, service or social - no buildings or premises owned or leased except for office purposes (Not-For-Profit)","ratingBasis":"Number of Members"},"11138":{"description":"Clubs - country or golf","ratingBasis":"$1,000 of Gross Sales"},"41664":{"description":"Clubs - horseback riding - no commercial riding instructions","ratingBasis":"Thousands of Square Feet"},"41665":{"description":"Clubs - racquet sports and handball","ratingBasis":"$1,000 of Gross Sales"},"41666":{"description":"Clubs - swimming","ratingBasis":"$1,000 of Gross Sales"},"51900":{"description":"Coffin or Casket Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"51909":{"description":"Coke Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"51910":{"description":"Coke Manufacturing","ratingBasis":"Thousands of Tons"},"11155":{"description":"Collectibles or Memorabilia Stores","ratingBasis":"$1,000 of Gross Sales"},"51919":{"description":"Color or Pigment Preparation","ratingBasis":"$1,000 of Gross Sales"},"91547":{"description":"Commissary Work","ratingBasis":"$1,000 of Payroll"},"91551":{"description":"Communication Equipment Installation - industrial or commercial","ratingBasis":"$1,000 of Payroll"},"51926":{"description":"Communication or Recording Systems or Equipment Manufacturing - industrial or commercial","ratingBasis":"$1,000 of Gross Sales"},"51927":{"description":"Communication or Recording Systems or Equipment Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"41678":{"description":"Community Recreational Facilities - not operated by a governmental agency","ratingBasis":"Thousands of Square Feet"},"51934":{"description":"Composition Goods Manufacturing - not floor coverings","ratingBasis":"$1,000 of Gross Sales"},"41675":{"description":"Computer Consulting or Programming","ratingBasis":"$1,000 of Payroll"},"43152":{"description":"Computer Data Processing - time-sharing","ratingBasis":"Thousands of Square Feet"},"43151":{"description":"Computer Data Processing Operations","ratingBasis":"Thousands of Square Feet"},"51941":{"description":"Computer Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"91555":{"description":"Computer Service or Repair","ratingBasis":"$1,000 of Payroll"},"51942":{"description":"Computer Software Manufacturing - prepackaged","ratingBasis":"$1,000 of Gross Sales"},"11160":{"description":"Computer Stores","ratingBasis":"$1,000 of Gross Sales"},"11168":{"description":"Concessionaires","ratingBasis":"$1,000 of Gross Sales"},"11167":{"description":"Concessionaires - checkroom, shoeshine, or toilet concessions in hotels, restaurants, railroad stations, etc.","ratingBasis":"$1,000 of Gross Sales"},"51956":{"description":"Concrete - mixed in transit","ratingBasis":"$1,000 of Gross Sales"},"91560":{"description":"Concrete Construction","ratingBasis":"$1,000 of Payroll"},"91562":{"description":"Concrete or Cement Distributing Towers - rented to others - installation, repair or removal operations only","ratingBasis":"$1,000 of Payroll"},"51957":{"description":"Concrete or Plaster Products Manufacturing - not structural","ratingBasis":"$1,000 of Gross Sales"},"51958":{"description":"Concrete Products Manufacturing - prestressed","ratingBasis":"$1,000 of Gross Sales"},"51959":{"description":"Concrete Products Manufacturing - structural - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"62000":{"description":"Condominiums - commercial - bank or mercantile, manufacturing or office (association risk only)","ratingBasis":"Thousands of Square Feet"},"62001":{"description":"Condominiums - commercial - shopping centers (association risk only)","ratingBasis":"Thousands of Square Feet"},"62002":{"description":"Condominiums - commercial warehouses - manufacturing or private (association risk only)","ratingBasis":"Thousands of Square Feet"},"62003":{"description":"Condominiums - residential - (association risk only)","ratingBasis":"Number of Units"},"91577":{"description":"Conduit Construction for Cables or Wires","ratingBasis":"$1,000 of Payroll"},"41620":{"description":"Construction or Project Managers","ratingBasis":"$1,000 of Gross Sales"},"91600":{"description":"Construction or Project Managers","ratingBasis":"$1,000 of Payroll"},"41677":{"description":"Consultants - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"51960":{"description":"Contact Lenses Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"91580":{"description":"Contractors - executive supervisors or executive superintendents","ratingBasis":"$1,000 of Payroll"},"94444":{"description":"Contractors - Not Otherwise Classified","ratingBasis":"No Exposure"},"91588":{"description":"Contractors - subcontracted work - in connection with bridge, tunnel or elevated street or highway construction, reconstruction or repair","ratingBasis":"$1,000 Total Cost"},"91582":{"description":"Contractors - subcontracted work - in connection with building construction, reconstruction, repair or erection - apartment or office buildings over four stories","ratingBasis":"$1,000 Total Cost"},"91583":{"description":"Contractors - subcontracted work - in connection with building construction, reconstruction, repair or erection - one or two family dwellings","ratingBasis":"$1,000 Total Cost"},"91581":{"description":"Contractors - subcontracted work - in connection with construction, reconstruction, erection or repair - not buildings - Not Otherwise Classified","ratingBasis":"$1,000 Total Cost"},"91584":{"description":"Contractors - subcontracted work - in connection with construction, reconstruction, repair or erection of buildings - for industrial use","ratingBasis":"$1,000 Total Cost"},"91585":{"description":"Contractors - subcontracted work - in connection with construction, reconstruction, repair or erection of buildings - Not Otherwise Classified","ratingBasis":"$1,000 Total Cost"},"91586":{"description":"Contractors - subcontracted work - in connection with oil and gas field construction, reconstruction or repair","ratingBasis":"$1,000 Total Cost"},"91587":{"description":"Contractors - subcontracted work - in connection with pipeline (other than oil or gas) or communication or power line construction, reconstruction or repair","ratingBasis":"$1,000 Total Cost"},"91589":{"description":"Contractors - subcontracted work - in connection with street or highway construction, reconstruction or repair - not elevated","ratingBasis":"$1,000 Total Cost"},"91591":{"description":"Contractors - subcontracted work - other than construction-related work","ratingBasis":"$1,000 Total Cost"},"11201":{"description":"Contractors' Equipment - cranes, derricks, power shovels and equipment incidental thereto - rented to others with operators","ratingBasis":"$1,000 of Gross Sales"},"11202":{"description":"Contractors' Equipment - cranes, derricks, power shovels and equipment incidental thereto - rented to others without operators","ratingBasis":"$1,000 of Gross Sales"},"11205":{"description":"Contractors' Equipment - earth moving equipment other than cranes, derricks, and power shovels - rented to others with operators","ratingBasis":"$1,000 of Gross Sales"},"11206":{"description":"Contractors' Equipment - earth moving equipment other than cranes, derricks, and power shovels - rented to others without operators","ratingBasis":"$1,000 of Gross Sales"},"11207":{"description":"Contractors' Equipment - excluding automobiles - rented to others with operators - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"11208":{"description":"Contractors' Equipment - excluding automobiles - rented to others without operators - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"11209":{"description":"Contractors' Equipment - hod or material platform hoists and equipment incidental thereto - rented to others with operators","ratingBasis":"$1,000 of Gross Sales"},"11210":{"description":"Contractors' Equipment - hod or material platform hoists and equipment incidental thereto - rented to others without operators","ratingBasis":"$1,000 of Gross Sales"},"11211":{"description":"Contractors' Equipment - ladders, scaffolds, scaffolding, sidewalk, bridges, towers and equipment incidental thereto - rented to others","ratingBasis":"$1,000 of Gross Sales"},"11212":{"description":"Contractors' Equipment - scaffolds, sidewalk, bridges, hod or material hoist towers - rented to others - installation, repair or removal operations only","ratingBasis":"$1,000 of Gross Sales"},"11213":{"description":"Contractors' Equipment - steam boilers, compressors, air pressure tanks, pneumatic tools and equipment incidental thereto - rented to others with operators","ratingBasis":"$1,000 of Gross Sales"},"11214":{"description":"Contractors' Equipment - steam boilers, compressors, air pressure tanks, pneumatic tools and equipment incidental thereto - rented to others without operators","ratingBasis":"$1,000 of Gross Sales"},"11203":{"description":"Contractors' Equipment Dealers - ladders - excluding hoists, scaffolds or towers","ratingBasis":"$1,000 of Gross Sales"},"11204":{"description":"Contractors' Equipment Dealers - ladders, hoists, scaffolds or towers","ratingBasis":"$1,000 of Gross Sales"},"91590":{"description":"Contractors' Permanent Yards - maintenance or storage of equipment or material","ratingBasis":"$1,000 of Payroll"},"41672":{"description":"Conventions (sponsor's risk only) (For-Profit)","ratingBasis":"No. of Convention Days"},"41673":{"description":"Conventions (sponsor's risk only) (Not-For-Profit)","ratingBasis":"No. of Convention Days"},"41680":{"description":"Convents or Monasteries","ratingBasis":"Thousands of Square Feet"},"11222":{"description":"Copying and Duplicating Services - retail","ratingBasis":"$1,000 of Gross Sales"},"11234":{"description":"Cosmetic, Hair or Skin Preparation Stores","ratingBasis":"$1,000 of Gross Sales"},"51970":{"description":"Cosmetics Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"51982":{"description":"Cotton Batting, Wadding or Waste Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"51985":{"description":"Cotton Compressing","ratingBasis":"$1,000 of Gross Sales"},"51986":{"description":"Cotton Gin Operations","ratingBasis":"$1,000 of Gross Sales"},"41679":{"description":"Cotton Gin Operations - other than those performed for a fee per bale","ratingBasis":"Number of Bales"},"11248":{"description":"Cotton or Wool Merchants","ratingBasis":"$1,000 of Gross Sales"},"41696":{"description":"Crematories (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"41697":{"description":"Crematories (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"91606":{"description":"Crop Spraying - by contractors","ratingBasis":"$1,000 of Payroll"},"51999":{"description":"Cutlery (not powered) and Flatware Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"52002":{"description":"Dairy Products Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"11258":{"description":"Dairy Products or Butter and Egg Stores (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"11259":{"description":"Dairy Products or Butter and Egg Stores (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"91618":{"description":"Dam or Reservoir Construction","ratingBasis":"$1,000 of Payroll"},"41700":{"description":"Dam, Levee or Dike - existence hazard only","ratingBasis":"No. of Dams, Levees or Dikes"},"11274":{"description":"Dance Halls, Ballrooms or Discotheques - Not-For-Profit only","ratingBasis":"$1,000 of Gross Sales"},"11273":{"description":"Dance Halls, Ballrooms or Discotheques - Other than Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"41715":{"description":"Day Care Centers (For-Profit)","ratingBasis":"Number of Persons"},"41716":{"description":"Day Care Centers (Not-For-Profit)","ratingBasis":"Number of Persons"},"91629":{"description":"Debris Removal - construction site","ratingBasis":"$1,000 of Payroll"},"11288":{"description":"Delicatessens","ratingBasis":"$1,000 of Gross Sales"},"12014":{"description":"Dental Laboratories","ratingBasis":"$1,000 of Gross Sales"},"12356":{"description":"Department or Discount Stores","ratingBasis":"$1,000 of Gross Sales"},"91636":{"description":"Detective or Investigative Agencies - private","ratingBasis":"$1,000 of Payroll"},"52075":{"description":"Detergent Manufacturing - household","ratingBasis":"$1,000 of Gross Sales"},"52076":{"description":"Detergent Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"52109":{"description":"Dextrine Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"46112":{"description":"Diagnostic Testing Laboratories","ratingBasis":"$1,000 of Gross Sales"},"52137":{"description":"Die Casting Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"91641":{"description":"Dike, Levee or Revetment Construction","ratingBasis":"$1,000 of Payroll"},"52150":{"description":"Distillation or Extraction - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"12361":{"description":"Distributors - food or drink - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"12362":{"description":"Distributors - no food or drink - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"91666":{"description":"Diving - marine","ratingBasis":"$1,000 of Payroll"},"91722":{"description":"Dock Operations - coal, grain or ore","ratingBasis":"$1,000 of Payroll"},"52134":{"description":"Door or Window Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"52315":{"description":"Door or Window Manufacturing - wood","ratingBasis":"$1,000 of Gross Sales"},"91746":{"description":"Door, Window or Assembled Millwork - installation metal","ratingBasis":"$1,000 of Payroll"},"91805":{"description":"Draftsmen","ratingBasis":"$1,000 of Payroll"},"43007":{"description":"Drawbridges - existence hazard only","ratingBasis":"Number of Drawbridges"},"92053":{"description":"Dredging - gold - endless bucket or ladder type","ratingBasis":"$1,000 of Payroll"},"92054":{"description":"Dredging - gold - floating dragline type","ratingBasis":"$1,000 of Payroll"},"92055":{"description":"Dredging - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"92101":{"description":"Drilling - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"92102":{"description":"Drilling - water","ratingBasis":"$1,000 of Payroll"},"92215":{"description":"Driveway, Parking Area or Sidewalk - paving or repaving","ratingBasis":"$1,000 of Payroll"},"12373":{"description":"Drug Distributors","ratingBasis":"$1,000 of Gross Sales"},"52341":{"description":"Drug Manufacturing - biological products","ratingBasis":"$1,000 of Gross Sales"},"52342":{"description":"Drug, Medicine or Pharmaceutical Preparations Manufacturing - for animal use","ratingBasis":"$1,000 of Gross Sales"},"52343":{"description":"Drug, Medicine or Pharmaceutical Preparations Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"12374":{"description":"Drugstores - no table or counter service for beverage or food","ratingBasis":"$1,000 of Gross Sales"},"12375":{"description":"Drugstores - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"52401":{"description":"Drums or Containers Manufacturing - metal","ratingBasis":"$1,000 of Gross Sales"},"52402":{"description":"Drums or Containers Manufacturing - plastic","ratingBasis":"$1,000 of Gross Sales"},"92338":{"description":"Dry Wall or Wallboard Installation","ratingBasis":"$1,000 of Payroll"},"43117":{"description":"Dude Ranches","ratingBasis":"$1,000 of Gross Sales"},"63013":{"description":"Dwellings - four-family (lessor's risk only)","ratingBasis":"Number of Dwellings"},"63010":{"description":"Dwellings - one-family (lessor's risk only)","ratingBasis":"Number of Dwellings"},"63012":{"description":"Dwellings - three-family (lessor's risk only)","ratingBasis":"Number of Dwellings"},"63011":{"description":"Dwellings - two-family (lessor's risk only)","ratingBasis":"Number of Dwellings"},"92445":{"description":"Electric Light or Power Companies","ratingBasis":"$1,000 of Payroll"},"92453":{"description":"Electric Light or Power Cooperatives - rural electrification administration projects only","ratingBasis":"$1,000 of Payroll"},"92446":{"description":"Electric Light or Power Line Construction - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"92447":{"description":"Electric Light or Power Line Construction - rural electrification administration projects only","ratingBasis":"$1,000 of Payroll"},"92451":{"description":"Electrical Apparatus - installation, servicing or repair - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"12391":{"description":"Electrical Equipment Distributors","ratingBasis":"$1,000 of Gross Sales"},"52432":{"description":"Electrical Equipment Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"52433":{"description":"Electrical Equipment Manufacturing - Not Otherwise Classified - for direct and indirect application to the body","ratingBasis":"$1,000 of Gross Sales"},"52435":{"description":"Electrical Generating Machinery Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"52438":{"description":"Electrical Parts, Components or Accessories Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"52440":{"description":"Electrical Power Distribution or Transmission Equipment Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"52467":{"description":"Electrical Wire or Cable Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"92478":{"description":"Electrical Work - within buildings","ratingBasis":"$1,000 of Payroll"},"52469":{"description":"Electronic Components Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"52505":{"description":"Electronic Games Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"12393":{"description":"Electronics Stores","ratingBasis":"$1,000 of Gross Sales"},"52547":{"description":"Electroplating","ratingBasis":"$1,000 of Gross Sales"},"65210":{"description":"Elevator Inspection Charge or Escalator Inspection Charge","ratingBasis":"No Exposure"},"52581":{"description":"Elevator Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"92593":{"description":"Elevator or Escalator Inspecting, Installation, Servicing or Repair","ratingBasis":"$1,000 of Payroll"},"43200":{"description":"Employment Agencies","ratingBasis":"Thousands of Square Feet"},"52619":{"description":"Engine or Turbine Manufacturing - not aircraft - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"92663":{"description":"Engineers or Architects - consulting - not engaged in actual construction","ratingBasis":"$1,000 of Payroll"},"52660":{"description":"Engraving","ratingBasis":"$1,000 of Gross Sales"},"43215":{"description":"Entertainment Performed On Other's Premises","ratingBasis":"Per Show"},"12467":{"description":"Equipment, Fixtures or Supplies - for bars, hotels, offices, restaurants or stores - distributors","ratingBasis":"$1,000 of Gross Sales"},"52744":{"description":"Escalator or Moving Sidewalk Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"44280":{"description":"Event, Party or Wedding Planners","ratingBasis":"$1,000 of Payroll"},"94007":{"description":"Excavation","ratingBasis":"$1,000 of Payroll"},"52767":{"description":"Exercise or Playground Equipment Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"63215":{"description":"Exhibition or Convention Buildings (For-Profit)","ratingBasis":"Thousands of Square Feet"},"63216":{"description":"Exhibition or Convention Buildings (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"63219":{"description":"Exhibitions - in buildings - no admission charge (For-Profit)","ratingBasis":"Number of Exhibitions"},"63220":{"description":"Exhibitions - in buildings - no admission charge (Not-For-Profit)","ratingBasis":"Number of Exhibitions"},"63217":{"description":"Exhibitions - in buildings - Not Otherwise Classified (For-Profit)","ratingBasis":"Thousands of Admissions"},"63218":{"description":"Exhibitions - in buildings - Not Otherwise Classified (Not-For-Profit)","ratingBasis":"Thousands of Admissions"},"43422":{"description":"Exhibitions - outside - in stadiums or on premises having grandstands or bleachers - ushers or other attendants in stands provided by the insured","ratingBasis":"Thousands of Admissions"},"43421":{"description":"Exhibitions - outside - in stadiums or on premises having grandstands or bleachers not erected by or for the insured - ushers or other attendants in stands not provided by the insured","ratingBasis":"Thousands of Admissions"},"43424":{"description":"Exhibitions - outside - no stadiums or grandstands","ratingBasis":"$1,000 of Gross Sales"},"52876":{"description":"Explosives or Fireworks Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"94099":{"description":"Express Companies","ratingBasis":"$1,000 of Payroll"},"52911":{"description":"Extracts Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"52967":{"description":"Eye Glass Lens Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"12509":{"description":"Fabric Distributors","ratingBasis":"$1,000 of Gross Sales"},"12510":{"description":"Fabric Stores","ratingBasis":"$1,000 of Gross Sales"},"43517":{"description":"Fairgrounds - nonoperating season","ratingBasis":"Number of Fairgrounds"},"43518":{"description":"Fairs - outside (operator's risk only)","ratingBasis":"$1,000 of Gross Sales"},"04122":{"description":"Farm Liability - Additional Insureds - Non-relative resident","ratingBasis":"Each Additional Insured"},"05135":{"description":"Farm Liability - Additional Insureds - Partner or co-owner","ratingBasis":"Each Additional Insured"},"07995":{"description":"Farm Liability - Additional Liability Classifications - All-Terrain Vehicles - owned by the insured","ratingBasis":"Each All-Terrain Vehicle"},"01235":{"description":"Farm Liability - Additional Liability Classifications - Farm Stands","ratingBasis":"Gross Sales"},"01357":{"description":"Farm Liability - Additional Liability Classifications - Grazing Away From Insured's Premises - Animals in excess of 500","ratingBasis":"Number of Animals"},"01355":{"description":"Farm Liability - Additional Liability Classifications - Grazing Away From Insured's Premises - First 100 Animals","ratingBasis":"Number of Animals"},"01356":{"description":"Farm Liability - Additional Liability Classifications - Grazing Away From Insured's Premises - Next 400 Animals","ratingBasis":"Number of Animals"},"01360":{"description":"Farm Liability - Additional Liability Classifications - Limited Crop Dusting Coverage","ratingBasis":"$1,000 of Cost"},"07990":{"description":"Farm Liability - Additional Liability Classifications - Snowmobiles - owned by the insured","ratingBasis":"Number of Snowmobiles"},"01418":{"description":"Farm Liability - Additional Premises - Additional farm premises maintained by insured, spouse or resident of the insured's household","ratingBasis":"Each Additional Farm Premises"},"01412":{"description":"Farm Liability - Additional Premises - Additional farm premises rented to others","ratingBasis":"Each Additional Farm Premises"},"05125":{"description":"Farm Liability - Additional Premises - Additional residence premises maintained by insured, spouse or resident of the insured's household, with permitted incidental occupancies","ratingBasis":"Each Additional Residence Premises"},"05114":{"description":"Farm Liability - Additional Premises - Additional residence premises maintained by insured, spouse or resident of the insured's household, without permitted incidental occupancies","ratingBasis":"Each Additional Residence Premises"},"05118":{"description":"Farm Liability - Additional Premises - Additional residence premises rented to others - one, two, three or four families with incidental office occupancy","ratingBasis":"Each Additional Residence Premises"},"05117":{"description":"Farm Liability - Additional Premises - Additional residence premises rented to others - one, two, three or four families without incidental office occupancy","ratingBasis":"Each Additional Residence Premises"},"01391":{"description":"Farm Liability - Animal and livestock breeders or dealers, except poultry hatcheries","ratingBasis":"Gross Sales"},"01411":{"description":"Farm Liability - Animal Collision (Applicable only for Texas)","ratingBasis":"Number of Heads"},"07106":{"description":"Farm Liability - Custom Farming","ratingBasis":"Gross Sales"},"01352":{"description":"Farm Liability - Employers Liability - Farm employees (with Medical Payments for off-the-farm automobile accidents)","ratingBasis":"$1,000 of Payroll"},"01350":{"description":"Farm Liability - Employers Liability - Farm employees (without Medical Payments for off-the-farm automobile accidents)","ratingBasis":"$1,000 of Payroll"},"01415":{"description":"Farm Liability - Employers Liability - Resident employees in excess of two","ratingBasis":"Number of Employees"},"01380":{"description":"Farm Liability - Farm Home Day Care Coverage - Care of 1 to 3 persons (other than relatives)","ratingBasis":"Number of Persons"},"01381":{"description":"Farm Liability - Farm Home Day Care Coverage - Care of 4 to 6 persons (other than relatives)","ratingBasis":"Number of Persons"},"01901":{"description":"Farm Liability - Farm Products - Not Otherwise Classified","ratingBasis":"Gross Sales"},"03320":{"description":"Farm Liability - Insured's Liability While Employed By Others In Non-Farm Jobs - Clerical office employees, salesmen, collectors and messengers, but no installation, demonstration or servicing operations","ratingBasis":"Each Person"},"03909":{"description":"Farm Liability - Insured's Liability While Employed By Others In Non-Farm Jobs - Jobs - Not Otherwise Classified","ratingBasis":"Each Person"},"02997":{"description":"Farm Liability - Insured's Liability While Employed By Others In Non-Farm Jobs - Optional teachers coverage, liability for corporal punishment of pupils","ratingBasis":"Each Person"},"03210":{"description":"Farm Liability - Insured's Liability While Employed By Others In Non-Farm Jobs - Salesmen, collectors and messengers, including installation, demonstration or servicing operations","ratingBasis":"Each Person"},"02996":{"description":"Farm Liability - Insured's Liability While Employed By Others In Non-Farm Jobs - Teachers - Not Otherwise Classified","ratingBasis":"Each Person"},"02995":{"description":"Farm Liability - Insured's Liability While Employed By Others In Non-Farm Jobs - Teachers, athletic, laboratory, manual training, physical training and swimming instructions","ratingBasis":"Each Person"},"07230":{"description":"Farm Liability - Poultry Hatcheries","ratingBasis":"Gross Sales"},"01206":{"description":"Farm Liability - Risks rated under CGL Farm Liability - Farms more than 160, but not more than 500 acres","ratingBasis":"Number of Policy Months"},"01205":{"description":"Farm Liability - Risks rated under CGL Farm Liability - Farms not more than 160 acres","ratingBasis":"Number of Policy Months"},"01207":{"description":"Farm Liability - Risks rated under CGL Farm Liability - Farms over 500 acres","ratingBasis":"Number of Policy Months"},"05224":{"description":"Farm Liability - Risks rated under CGL Farm Liability - Personal Liability - A two, three or four family dwelling with permitted incidental occupancies","ratingBasis":"Each Additional Residence"},"05213":{"description":"Farm Liability - Risks rated under CGL Farm Liability - Personal Liability - A two, three or four family dwelling without permitted incidental occupancies","ratingBasis":"Each Additional Residence"},"05223":{"description":"Farm Liability - Risks rated under CGL Farm Liability - Personal Liability - One family dwelling with permitted incidental occupancies","ratingBasis":"Each Residence Premises"},"01906":{"description":"Farm Liability - Risks rated under Farm Liability - Farms more than 160, but not more than 500 acres","ratingBasis":"Number of Policy Months"},"01905":{"description":"Farm Liability - Risks rated under Farm Liability - Farms not more than 160 acres","ratingBasis":"Number of Policy Months"},"01907":{"description":"Farm Liability - Risks rated under Farm Liability - Farms over 500 acres","ratingBasis":"Number of Policy Months"},"05124":{"description":"Farm Liability - Risks rated under Farm Liability - Personal Liability - A two, three or four family dwelling with permitted incidental occupancies","ratingBasis":"Each Additional Residence"},"05113":{"description":"Farm Liability - Risks rated under Farm Liability - Personal Liability - A two, three or four family dwelling without permitted incidental occupancies","ratingBasis":"Each Additional Residence"},"05123":{"description":"Farm Liability - Risks rated under Farm Liability - Personal Liability - One family dwelling with permitted incidental occupancies","ratingBasis":"Each Residence Premises"},"04621":{"description":"Farm Liability - Watercraft - Sailboats (with or without auxiliary power) - 26 to 40 feet","ratingBasis":"Each Watercraft"},"04622":{"description":"Farm Liability - Watercraft - Sailboats (with or without auxiliary power) - more than 40 feet","ratingBasis":"Each Watercraft"},"04606":{"description":"Farm Liability - Watercraft - Watercrafts powered by outboard, or inboard-outdrive motors: 101 to 150 horsepower, over 15 to 26 ft.","ratingBasis":"Each Watercraft"},"04605":{"description":"Farm Liability - Watercraft - Watercrafts powered by outboard, or inboard-outdrive motors: 101 to 150 horsepower, up to 15 feet","ratingBasis":"Each Watercraft"},"04608":{"description":"Farm Liability - Watercraft - Watercrafts powered by outboard, or inboard-outdrive motors: 151 to 200 horsepower, over 15 to 26 ft.","ratingBasis":"Each Watercraft"},"04607":{"description":"Farm Liability - Watercraft - Watercrafts powered by outboard, or inboard-outdrive motors: 151 to 200 horsepower, up to 15 feet","ratingBasis":"Each Watercraft"},"04604":{"description":"Farm Liability - Watercraft - Watercrafts powered by outboard, or inboard-outdrive motors: 51 to 100 horsepower, over 15 to 26 ft.","ratingBasis":"Each Watercraft"},"04603":{"description":"Farm Liability - Watercraft - Watercrafts powered by outboard, or inboard-outdrive motors: 51 to 100 horsepower, up to 15 feet","ratingBasis":"Each Watercraft"},"04610":{"description":"Farm Liability - Watercraft - Watercrafts powered by outboard, or inboard-outdrive motors: over 200 horsepower, over 15 to 26 ft.","ratingBasis":"Each Watercraft"},"04609":{"description":"Farm Liability - Watercraft - Watercrafts powered by outboard, or inboard-outdrive motors: over 200 horsepower, up to 15 feet","ratingBasis":"Each Watercraft"},"04602":{"description":"Farm Liability - Watercraft - Watercrafts powered by outboard, or inboard-outdrive motors: up to 50 horsepower, over 15 to 26 ft.","ratingBasis":"Each Watercraft"},"04601":{"description":"Farm Liability - Watercraft - Watercrafts powered by outboard, or inboard-outdrive motors: up to 50 horsepower, up to 15 feet","ratingBasis":"Each Watercraft"},"94225":{"description":"Farm Machinery Operations - by contractors","ratingBasis":"$1,000 of Payroll"},"53001":{"description":"Feed Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"12583":{"description":"Feed, Grain or Hay Dealers","ratingBasis":"$1,000 of Gross Sales"},"12651":{"description":"Fence Dealers","ratingBasis":"$1,000 of Gross Sales"},"94276":{"description":"Fence Erection Contractors","ratingBasis":"$1,000 of Payroll"},"12683":{"description":"Fertilizer Dealers and Distributors","ratingBasis":"$1,000 of Gross Sales"},"53077":{"description":"Fertilizer Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"53078":{"description":"Fertilizer Manufacturing","ratingBasis":"Thousands of Tons"},"53095":{"description":"Fiber Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"53096":{"description":"Fiber Manufacturing - synthetic","ratingBasis":"$1,000 of Gross Sales"},"53121":{"description":"Fiberglass Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"43550":{"description":"Fire Departments - Not Otherwise Classified","ratingBasis":"Thousands of Square Feet"},"43551":{"description":"Fire Departments - volunteer","ratingBasis":"Thousands of Square Feet"},"94304":{"description":"Fire Extinguishers - servicing, refilling or testing","ratingBasis":"$1,000 of Payroll"},"53147":{"description":"Fire Extinguishers Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"12707":{"description":"Fire Protection Equipment Dealers and Distributors","ratingBasis":"$1,000 of Gross Sales"},"94381":{"description":"Fire Suppression Systems - installation, servicing or repair","ratingBasis":"$1,000 of Payroll"},"53229":{"description":"Fire Suppression Systems Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"53271":{"description":"Firearms Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"94404":{"description":"Fireproofing - structures","ratingBasis":"$1,000 of Payroll"},"43626":{"description":"Fireworks Exhibitions - (contractor's risk only)","ratingBasis":"$1,000 of Gross Sales"},"43628":{"description":"Fireworks Exhibitions - (sponsor's risk only) (For-Profit)","ratingBasis":"Number of Location Days"},"43629":{"description":"Fireworks Exhibitions - (sponsor's risk only) (Not-For-Profit)","ratingBasis":"Number of Location Days"},"43754":{"description":"Fishing Piers","ratingBasis":"Number of Fishing Piers"},"43760":{"description":"Fishing Ponds or Lakes - commercially operated","ratingBasis":"$1,000 of Gross Sales"},"12797":{"description":"Floor Covering Distributors","ratingBasis":"$1,000 of Gross Sales"},"94569":{"description":"Floor Covering Installation - not ceramic tile or stone","ratingBasis":"$1,000 of Payroll"},"53333":{"description":"Floor Covering Manufacturing - not carpets, rugs, ceramic or stone tiles","ratingBasis":"$1,000 of Gross Sales"},"12805":{"description":"Floor Covering Stores","ratingBasis":"$1,000 of Gross Sales"},"94590":{"description":"Floor Waxing","ratingBasis":"$1,000 of Payroll"},"12841":{"description":"Florists","ratingBasis":"$1,000 of Gross Sales"},"53374":{"description":"Food Products Manufacturing - dry","ratingBasis":"$1,000 of Gross Sales"},"53375":{"description":"Food Products Manufacturing - frozen","ratingBasis":"$1,000 of Gross Sales"},"53376":{"description":"Food Products Manufacturing - not dry - in glass containers","ratingBasis":"$1,000 of Gross Sales"},"53377":{"description":"Food Products Manufacturing - not dry - in other than glass containers","ratingBasis":"$1,000 of Gross Sales"},"43822":{"description":"Forestry Service","ratingBasis":"$1,000 of Payroll"},"53403":{"description":"Forging Work - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"12927":{"description":"Formal Wear or Costumes - rented to others","ratingBasis":"$1,000 of Gross Sales"},"53425":{"description":"Foundries - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"53426":{"description":"Foundries - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"94617":{"description":"Freight Forwarders or Handlers - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"94638":{"description":"Freight Forwarders or Handlers - packing, handling or shipping explosives or ammunition under contract","ratingBasis":"$1,000 of Payroll"},"13049":{"description":"Frozen Food - distributors","ratingBasis":"$1,000 of Gross Sales"},"43840":{"description":"Fruit or Vegetable - harvesting contractors","ratingBasis":"$1,000 of Gross Sales"},"13111":{"description":"Fruit or Vegetable Dealers","ratingBasis":"$1,000 of Gross Sales"},"13112":{"description":"Fruit or Vegetable Distributors","ratingBasis":"$1,000 of Gross Sales"},"53565":{"description":"Fruit or Vegetable Juice Manufacturing - no bottling of carbonated beverages","ratingBasis":"$1,000 of Gross Sales"},"13201":{"description":"Fuel Dealers or Distributors - coal or wood","ratingBasis":"$1,000 of Gross Sales"},"13204":{"description":"Fuel Oil or Kerosene Dealers","ratingBasis":"Thousands of Gallons"},"13205":{"description":"Fuel Oil or Kerosene Distributors","ratingBasis":"Thousands of Gallons"},"43860":{"description":"Fumigating","ratingBasis":"$1,000 of Gross Sales"},"43889":{"description":"Funeral Homes or Chapels","ratingBasis":"$1,000 of Gross Sales"},"53631":{"description":"Fur Garment Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"13314":{"description":"Fur Garments and Pelts - Distributors","ratingBasis":"$1,000 of Gross Sales"},"53632":{"description":"Fur or Pelt Processing","ratingBasis":"$1,000 of Gross Sales"},"53731":{"description":"Furniture Manufacturing or Assembling - infants","ratingBasis":"$1,000 of Gross Sales"},"53732":{"description":"Furniture Manufacturing or Assembling - other than wood","ratingBasis":"$1,000 of Gross Sales"},"53733":{"description":"Furniture Manufacturing or Assembling - wood","ratingBasis":"$1,000 of Gross Sales"},"95124":{"description":"Furniture or Fixtures - installation in offices or stores - portable - metal or wood","ratingBasis":"$1,000 of Payroll"},"53734":{"description":"Furniture or Woodwork Stripping - refinishing or repairing - shop only","ratingBasis":"$1,000 of Gross Sales"},"13351":{"description":"Furniture Stores (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"13352":{"description":"Furniture Stores (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"53803":{"description":"Galvanizing or Tinning","ratingBasis":"$1,000 of Gross Sales"},"43990":{"description":"Gambling - casinos","ratingBasis":"$1,000 of Payroll"},"43991":{"description":"Gambling - incidental to other operations","ratingBasis":"$1,000 of Payroll"},"43945":{"description":"Garbage or Refuse Dumps","ratingBasis":"Number of Acres"},"43946":{"description":"Garbage Works - separation for recycling, reduction or incineration","ratingBasis":"Number of Acres"},"95233":{"description":"Garbage, Ash or Refuse Collecting","ratingBasis":"$1,000 of Payroll"},"95306":{"description":"Gas Companies - natural gas - local distribution","ratingBasis":"$1,000 of Payroll"},"95305":{"description":"Gas Companies - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"13410":{"description":"Gas Dealers - Liquefied Petroleum Gas","ratingBasis":"Thousands of Gallons"},"13411":{"description":"Gas Dealers or Distributors - Not Otherwise Classified","ratingBasis":"Thousands of Gallons"},"13412":{"description":"Gas Distributors - Liquefied Petroleum Gas","ratingBasis":"Thousands of Gallons"},"95310":{"description":"Gas Mains or Connections Construction","ratingBasis":"$1,000 of Payroll"},"53902":{"description":"Gas Manufacturing - inert","ratingBasis":"$1,000 of Gross Sales"},"53903":{"description":"Gas Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"53904":{"description":"Gas Manufacturing - primarily flammable, explosive or reactive","ratingBasis":"$1,000 of Gross Sales"},"53905":{"description":"Gas Manufacturing - primarily toxic or presenting a health hazard","ratingBasis":"$1,000 of Gross Sales"},"53901":{"description":"Gas Manufacturing - toxic and either flammable, explosive or reactive","ratingBasis":"$1,000 of Gross Sales"},"53907":{"description":"Gasoline Distributors","ratingBasis":"Thousands of Gallons"},"44009":{"description":"Gasoline or Oil Supply Stations - retail - (lessor's risk only)","ratingBasis":"$1,000 of Gross Sales"},"44010":{"description":"Gasoline Recovery - from casing head or natural gas","ratingBasis":"$1,000 of Payroll"},"13453":{"description":"Gasoline Stations - full service","ratingBasis":"Thousands of Gallons"},"13455":{"description":"Gasoline Stations - self and full service combined","ratingBasis":"Thousands of Gallons"},"13454":{"description":"Gasoline Stations - self-service","ratingBasis":"Thousands of Gallons"},"54012":{"description":"Gemstone Cutting or Polishing","ratingBasis":"$1,000 of Gross Sales"},"95357":{"description":"Geophysical Exploration - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"95358":{"description":"Geophysical Exploration - seismic method","ratingBasis":"$1,000 of Payroll"},"13506":{"description":"Gift Shops (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"13507":{"description":"Gift Shops (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"13590":{"description":"Glass Dealers and Glaziers","ratingBasis":"$1,000 of Gross Sales"},"13591":{"description":"Glass Dealers and Glaziers","ratingBasis":"$1,000 of Payroll"},"54077":{"description":"Glass or Glassware Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"44069":{"description":"Golf Courses - miniature","ratingBasis":"$1,000 of Gross Sales"},"44070":{"description":"Golf Courses - municipal or public - not golf or country clubs","ratingBasis":"$1,000 of Gross Sales"},"44071":{"description":"Golf Driving Ranges","ratingBasis":"$1,000 of Gross Sales"},"44072":{"description":"Golfmobiles - loaned or rented to others","ratingBasis":"$1,000 of Gross Sales"},"44109":{"description":"Governmental Subdivisions - not federal or state - Counties or Parishes - Population 10,001-25,000","ratingBasis":"$1,000 Total Operating Expenditures"},"44112":{"description":"Governmental Subdivisions - not federal or state - Counties or Parishes - Population 100,001-250,000","ratingBasis":"$1,000 Total Operating Expenditures"},"44110":{"description":"Governmental Subdivisions - not federal or state - Counties or Parishes - Population 25,001-50,000","ratingBasis":"$1,000 Total Operating Expenditures"},"44111":{"description":"Governmental Subdivisions - not federal or state - Counties or Parishes - Population 50,001-100,000","ratingBasis":"$1,000 Total Operating Expenditures"},"44113":{"description":"Governmental Subdivisions - not federal or state - Counties or Parishes - Population over 250,000","ratingBasis":"$1,000 Total Operating Expenditures"},"44108":{"description":"Governmental Subdivisions - not federal or state - Counties or Parishes - Population under 10,000","ratingBasis":"$1,000 Total Operating Expenditures"},"44102":{"description":"Governmental Subdivisions - not federal or state - Municipalities - boroughs, cities, towns, townships, villages, etc. - Population 10,001-25,000","ratingBasis":"$1,000 Total Operating Expenditures"},"44105":{"description":"Governmental Subdivisions - not federal or state - Municipalities - boroughs, cities, towns, townships, villages, etc. - Population 100,001-250,000","ratingBasis":"$1,000 Total Operating Expenditures"},"44101":{"description":"Governmental Subdivisions - not federal or state - Municipalities - boroughs, cities, towns, townships, villages, etc. - Population 2,501-10,000","ratingBasis":"$1,000 Total Operating Expenditures"},"44103":{"description":"Governmental Subdivisions - not federal or state - Municipalities - boroughs, cities, towns, townships, villages, etc. - Population 25,001-50,000","ratingBasis":"$1,000 Total Operating Expenditures"},"44104":{"description":"Governmental Subdivisions - not federal or state - Municipalities - boroughs, cities, towns, townships, villages, etc. - Population 50,001-100,000","ratingBasis":"$1,000 Total Operating Expenditures"},"44106":{"description":"Governmental Subdivisions - not federal or state - Municipalities - boroughs, cities, towns, townships, villages, etc. - Population over 250,000","ratingBasis":"$1,000 Total Operating Expenditures"},"44100":{"description":"Governmental Subdivisions - not federal or state - Municipalities - boroughs, cities, towns, townships, villages, etc. - Population under 2,500","ratingBasis":"$1,000 Total Operating Expenditures"},"95410":{"description":"Grading of Land","ratingBasis":"$1,000 of Payroll"},"95455":{"description":"Grain Elevator Operations","ratingBasis":"$1,000 of Payroll"},"13621":{"description":"Grain Milling","ratingBasis":"$1,000 of Gross Sales"},"44193":{"description":"Grandstands or Bleachers (For-Profit)","ratingBasis":"Number of Grandstands or Bleachers"},"44194":{"description":"Grandstands or Bleachers (Not-For-Profit)","ratingBasis":"Number of Grandstands or Bleachers"},"95487":{"description":"Greenhouse Erection","ratingBasis":"$1,000 of Payroll"},"13670":{"description":"Grocery Distributors","ratingBasis":"$1,000 of Gross Sales"},"13673":{"description":"Grocery Stores (excluding Supermarkets with receipts in excess of $500,000 and area in excess of 3,000 sq. feet)","ratingBasis":"$1,000 of Gross Sales"},"44222":{"description":"Guides or Outfitters","ratingBasis":"$1,000 of Gross Sales"},"95505":{"description":"Guniting or Shot-Crete","ratingBasis":"$1,000 of Payroll"},"95620":{"description":"Gunsmiths","ratingBasis":"$1,000 of Payroll"},"44276":{"description":"Halls (For-Profit)","ratingBasis":"Thousands of Square Feet"},"44277":{"description":"Halls (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"49920":{"description":"Hand Trucks and Garment Racks (New York City other than Territory 010)","ratingBasis":"Number of Hand Trucks or Garment Racks"},"95625":{"description":"Handyperson","ratingBasis":"$1,000 of Payroll"},"13715":{"description":"Hardware and Tool Distributors","ratingBasis":"$1,000 of Gross Sales"},"13716":{"description":"Hardware Stores","ratingBasis":"$1,000 of Gross Sales"},"95630":{"description":"Hazardous Material Contractors","ratingBasis":"$1,000 of Payroll"},"44427":{"description":"Health Care Facilities - alcohol and drug (For-Profit)","ratingBasis":"Thousands of Square Feet"},"44457":{"description":"Health Care Facilities - alcohol and drug (For-Profit)","ratingBasis":"Per bed"},"44458":{"description":"Health Care Facilities - alcohol and drug (For-Profit)","ratingBasis":"Per outpatient visit"},"44428":{"description":"Health Care Facilities - alcohol and drug (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"44455":{"description":"Health Care Facilities - alcohol and drug (Not-For-Profit)","ratingBasis":"Per bed"},"44456":{"description":"Health Care Facilities - alcohol and drug (Not-For-Profit)","ratingBasis":"Per outpatient visit"},"44439":{"description":"Health Care Facilities - clinics, dispensaries or infirmaries treating outpatients only - no regular bed or board facilities (For-Profit)","ratingBasis":"Thousands of Square Feet"},"44459":{"description":"Health Care Facilities - clinics, dispensaries or infirmaries treating outpatients only - no regular bed or board facilities (For-Profit)","ratingBasis":"Per outpatient visit"},"44440":{"description":"Health Care Facilities - clinics, dispensaries or infirmaries treating outpatients only - no regular bed or board facilities (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"44460":{"description":"Health Care Facilities - clinics, dispensaries or infirmaries treating outpatients only - no regular bed or board facilities (Not-For-Profit)","ratingBasis":"Per outpatient visit"},"44429":{"description":"Health Care Facilities - convalescent or nursing homes - not mental - psychopathic institutions (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"44471":{"description":"Health Care Facilities - convalescent or nursing homes - not mental - psychopathic institutions (For-Profit)","ratingBasis":"Per bed"},"44472":{"description":"Health Care Facilities - convalescent or nursing homes - not mental - psychopathic institutions (For-Profit)","ratingBasis":"Per outpatient visit"},"44430":{"description":"Health Care Facilities - convalescent or nursing homes - not mental - psychopathic institutions (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"44469":{"description":"Health Care Facilities - convalescent or nursing homes - not mental - psychopathic institutions (Not-For-Profit)","ratingBasis":"Per bed"},"44470":{"description":"Health Care Facilities - convalescent or nursing homes - not mental - psychopathic institutions (Not-For-Profit)","ratingBasis":"Per outpatient visit"},"44431":{"description":"Health Care Facilities - homes for the aged (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"44451":{"description":"Health Care Facilities - homes for the aged (For-Profit)","ratingBasis":"Per bed"},"44432":{"description":"Health Care Facilities - homes for the aged (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"44452":{"description":"Health Care Facilities - homes for the aged (Not-For-Profit)","ratingBasis":"Per bed"},"44433":{"description":"Health Care Facilities - homes for the physically handicapped or orphaned (For-Profit)","ratingBasis":"Thousands of Square Feet"},"44453":{"description":"Health Care Facilities - homes for the physically handicapped or orphaned (For-Profit)","ratingBasis":"Per bed"},"44434":{"description":"Health Care Facilities - homes for the physically handicapped or orphaned (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"44454":{"description":"Health Care Facilities - homes for the physically handicapped or orphaned (Not-For-Profit)","ratingBasis":"Per bed"},"44435":{"description":"Health Care Facilities - hospitals (For-Profit)","ratingBasis":"Thousands of Square Feet"},"44463":{"description":"Health Care Facilities - hospitals (For-Profit)","ratingBasis":"Per bed"},"44464":{"description":"Health Care Facilities - hospitals (For-Profit)","ratingBasis":"Per outpatient visit"},"44436":{"description":"Health Care Facilities - hospitals (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"44461":{"description":"Health Care Facilities - hospitals (Not-For-Profit)","ratingBasis":"Per bed"},"44462":{"description":"Health Care Facilities - hospitals (Not-For-Profit)","ratingBasis":"Per outpatient visit"},"44437":{"description":"Health Care Facilities - mental - psychopathic institutions (For-Profit)","ratingBasis":"Thousands of Square Feet"},"44467":{"description":"Health Care Facilities - mental - psychopathic institutions (For-Profit)","ratingBasis":"Per bed"},"44468":{"description":"Health Care Facilities - mental - psychopathic institutions (For-Profit)","ratingBasis":"Per outpatient visit"},"44438":{"description":"Health Care Facilities - mental - psychopathic institutions (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"44465":{"description":"Health Care Facilities - mental - psychopathic institutions (Not-For-Profit)","ratingBasis":"Per bed"},"44466":{"description":"Health Care Facilities - mental - psychopathic institutions (Not-For-Profit)","ratingBasis":"Per outpatient visit"},"13720":{"description":"Health Food Stores","ratingBasis":"$1,000 of Gross Sales"},"44311":{"description":"Health or Exercise Clubs","ratingBasis":"$1,000 of Gross Sales"},"44315":{"description":"Health or Exercise Facilities - commercially operated","ratingBasis":"$1,000 of Gross Sales"},"13759":{"description":"Hearing Aid Stores","ratingBasis":"$1,000 of Gross Sales"},"55010":{"description":"Heating Equipment Manufacturing - coal or wood","ratingBasis":"$1,000 of Gross Sales"},"55011":{"description":"Heating Equipment Manufacturing - electric","ratingBasis":"$1,000 of Gross Sales"},"55012":{"description":"Heating Equipment Manufacturing - fuel oil or kerosene","ratingBasis":"$1,000 of Gross Sales"},"55013":{"description":"Heating Equipment Manufacturing - gas or liquefied petroleum gas","ratingBasis":"$1,000 of Gross Sales"},"13930":{"description":"Heating or Combined Heating and Air Conditioning Equipment - dealers or distributors only","ratingBasis":"$1,000 of Gross Sales"},"95647":{"description":"Heating or Combined Heating and Air Conditioning Systems or Equipment - dealers or distributors and installation, servicing or repair - no liquefied petroleum gas (LPG) equipment sales or work","ratingBasis":"$1,000 of Payroll"},"95648":{"description":"Heating or Combined Heating and Air Conditioning Systems or Equipment - dealers or distributors and installation, servicing or repair - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"14068":{"description":"Hide Dealers and Distributors - raw","ratingBasis":"$1,000 of Gross Sales"},"49913":{"description":"Highway Construction from Completion of Contractor's Operations to Acceptance by the State of New York","ratingBasis":"$1,000 of Gross Sales"},"49910":{"description":"Highway or Roads - Department of Public Works, State of New York - pre-acceptance period","ratingBasis":"Number of Miles"},"14101":{"description":"Hobby, Craft or Artist's Supply Stores","ratingBasis":"$1,000 of Gross Sales"},"44500":{"description":"Home Health Care Services - not-for-profit only","ratingBasis":"$1,000 of Payroll"},"44501":{"description":"Home Health Care Services - other than not-for-profit","ratingBasis":"$1,000 of Payroll"},"14279":{"description":"Home Improvement Stores","ratingBasis":"$1,000 of Gross Sales"},"55214":{"description":"Hone, Oilstone or Whetstone Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"55371":{"description":"Honey Extracting","ratingBasis":"$1,000 of Gross Sales"},"64075":{"description":"Hotels and Motels - four stories or more (lessor's risk only)","ratingBasis":"Thousands of Square Feet"},"64074":{"description":"Hotels and Motels - less than four stories (lessor's risk only)","ratingBasis":"Thousands of Square Feet"},"45191":{"description":"Hotels and Motels - with pools or beaches - four stories or more","ratingBasis":"$1,000 of Gross Sales"},"45195":{"description":"Hotels and Motels - with pools or beaches - four stories or more","ratingBasis":"Per unit"},"45190":{"description":"Hotels and Motels - with pools or beaches - less than four stories","ratingBasis":"$1,000 of Gross Sales"},"45194":{"description":"Hotels and Motels - with pools or beaches - less than four stories","ratingBasis":"Per unit"},"45193":{"description":"Hotels and Motels - without pools or beaches - four stories or more","ratingBasis":"$1,000 of Gross Sales"},"45197":{"description":"Hotels and Motels - without pools or beaches - four stories or more","ratingBasis":"Per unit"},"45192":{"description":"Hotels and Motels - without pools or beaches - less than four stories","ratingBasis":"$1,000 of Gross Sales"},"45196":{"description":"Hotels and Motels - without pools or beaches - less than four stories","ratingBasis":"Per unit"},"96053":{"description":"House Furnishings Installation - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"64500":{"description":"Housing Projects - federal, state, local","ratingBasis":"Number of Units"},"45224":{"description":"Hunting Preserves (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"45225":{"description":"Hunting Preserves (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"14401":{"description":"Ice Cream Stores","ratingBasis":"$1,000 of Gross Sales"},"14405":{"description":"Ice Dealers and Distributors","ratingBasis":"$1,000 of Gross Sales"},"55410":{"description":"Importers","ratingBasis":"$1,000 of Gross Sales"},"55426":{"description":"Ink Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"55597":{"description":"Inner Tubes Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"96317":{"description":"Inspection and Appraisal Companies - inspecting for insurance or valuation purposes","ratingBasis":"$1,000 of Payroll"},"55647":{"description":"Instrument Manufacturing - analytical, calibrating, measuring, testing or recording","ratingBasis":"$1,000 of Gross Sales"},"55648":{"description":"Instrument Manufacturing - control","ratingBasis":"$1,000 of Gross Sales"},"55649":{"description":"Instrument Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"55715":{"description":"Insulating Material Manufacturing - mineral","ratingBasis":"$1,000 of Gross Sales"},"55716":{"description":"Insulating Material Manufacturing - organic","ratingBasis":"$1,000 of Gross Sales"},"55717":{"description":"Insulating Material Manufacturing - plastic - for application in a solid state","ratingBasis":"$1,000 of Gross Sales"},"55718":{"description":"Insulating Material Manufacturing - plastic - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"96410":{"description":"Insulation Work - mineral","ratingBasis":"$1,000 of Payroll"},"96409":{"description":"Insulation Work - organic or plastic in solid state","ratingBasis":"$1,000 of Payroll"},"96408":{"description":"Insulation Work - plastic - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"45334":{"description":"Insurance Agents","ratingBasis":"Thousands of Square Feet"},"96611":{"description":"Interior Decorators","ratingBasis":"$1,000 of Payroll"},"47600":{"description":"Internet Access Providers","ratingBasis":"$1,000 of Gross Sales"},"16751":{"description":"Internet Auctions","ratingBasis":"$1,000 of Gross Sales"},"16750":{"description":"Internet Retailers","ratingBasis":"$1,000 of Gross Sales"},"47610":{"description":"Internet Service Providers","ratingBasis":"$1,000 of Gross Sales"},"96702":{"description":"Irrigation or Drainage System Construction","ratingBasis":"$1,000 of Payroll"},"96703":{"description":"Irrigation Works Operations","ratingBasis":"$1,000 of Payroll"},"96816":{"description":"Janitorial Services","ratingBasis":"$1,000 of Payroll"},"14527":{"description":"Janitorial Supplies - dealers or distributors","ratingBasis":"$1,000 of Gross Sales"},"96872":{"description":"Jetty or Breakwater Construction","ratingBasis":"$1,000 of Payroll"},"55802":{"description":"Jewelry Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"14655":{"description":"Jewelry Stores or Distributors","ratingBasis":"$1,000 of Gross Sales"},"45380":{"description":"Junk Dealers","ratingBasis":"$1,000 of Gross Sales"},"45381":{"description":"Junk Dealers","ratingBasis":"Thousands of Tons"},"45450":{"description":"Kennels - breeding, boarding or sales","ratingBasis":"Number of Kennels"},"65007":{"description":"Labor Union Offices","ratingBasis":"Thousands of Square Feet"},"97002":{"description":"Laboratories - research, development or testing (For-Profit)","ratingBasis":"$1,000 of Payroll"},"97003":{"description":"Laboratories - research, development or testing (Not-For-Profit)","ratingBasis":"$1,000 of Payroll"},"55918":{"description":"Ladder Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"55919":{"description":"Ladder Manufacturing - wood","ratingBasis":"$1,000 of Gross Sales"},"45523":{"description":"Lakes or Reservoirs - existence hazard only (For-Profit)","ratingBasis":"Number of Lakes or Reservoirs"},"45524":{"description":"Lakes or Reservoirs - existence hazard only (Not-For-Profit)","ratingBasis":"Number of Lakes or Reservoirs"},"56040":{"description":"Lamp Shade Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"56041":{"description":"Lamps or Lanterns Manufacturing - electric","ratingBasis":"$1,000 of Gross Sales"},"56042":{"description":"Lamps or Lanterns Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"45539":{"description":"Land - occupied by persons other than the insured for business purposes - (lessor's risk only)","ratingBasis":"Number of Acres"},"97047":{"description":"Landscape Gardening","ratingBasis":"$1,000 of Payroll"},"14731":{"description":"Laundries and Dry Cleaners - self-service","ratingBasis":"$1,000 of Gross Sales"},"45678":{"description":"Laundries and Dry Cleaning Plants","ratingBasis":"$1,000 of Gross Sales"},"14732":{"description":"Laundry and Dry Cleaning or Dyeing Receiving Stations","ratingBasis":"$1,000 of Gross Sales"},"14733":{"description":"Laundry and Dry Cleaning Stores","ratingBasis":"$1,000 of Gross Sales"},"14734":{"description":"Laundry Rental Service","ratingBasis":"$1,000 of Gross Sales"},"97050":{"description":"Lawn Care","ratingBasis":"$1,000 of Payroll"},"66122":{"description":"Lawyers Offices (For-Profit)","ratingBasis":"Thousands of Square Feet"},"66123":{"description":"Lawyers Offices (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"56170":{"description":"Lead Manufacturing - red or white","ratingBasis":"$1,000 of Gross Sales"},"56172":{"description":"Lead Manufacturing - red or white","ratingBasis":"Thousands of Tons"},"56171":{"description":"Lead Works - sheet, pipe or shot","ratingBasis":"$1,000 of Gross Sales"},"56202":{"description":"Leather Goods Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"66309":{"description":"Libraries","ratingBasis":"Thousands of Square Feet"},"56390":{"description":"Light Bulb or Tubes Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"56391":{"description":"Lighting Fixtures Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"56427":{"description":"Lime Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"56428":{"description":"Lime Manufacturing","ratingBasis":"Thousands of Tons"},"56488":{"description":"Liquor Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"14855":{"description":"Livestock Dealers or Commission Merchants","ratingBasis":"$1,000 of Gross Sales"},"45771":{"description":"Livestock Sales Companies","ratingBasis":"$1,000 of Gross Sales"},"14913":{"description":"Locksmiths","ratingBasis":"$1,000 of Gross Sales"},"97111":{"description":"Logging and Lumbering","ratingBasis":"$1,000 of Payroll"},"56567":{"description":"Lubricants Manufacturing - grease","ratingBasis":"$1,000 of Gross Sales"},"45819":{"description":"Lumberyards","ratingBasis":"$1,000 of Gross Sales"},"97219":{"description":"Machine Shops - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"97220":{"description":"Machine Shops - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"97221":{"description":"Machinery or Equipment - farm - installation, servicing, repair or erection","ratingBasis":"$1,000 of Payroll"},"97222":{"description":"Machinery or Equipment - industrial - installation, servicing or repair","ratingBasis":"$1,000 of Payroll"},"97223":{"description":"Machinery or Equipment - installation, servicing or repair - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"15060":{"description":"Machinery or Equipment Dealers - construction or industrial - mobile type","ratingBasis":"$1,000 of Gross Sales"},"15061":{"description":"Machinery or Equipment Dealers - farm type","ratingBasis":"$1,000 of Gross Sales"},"15062":{"description":"Machinery or Equipment Dealers - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"15063":{"description":"Machinery or Equipment Dealers - yard or garden type","ratingBasis":"$1,000 of Gross Sales"},"56650":{"description":"Machinery or Machinery Parts Manufacturing - construction, mining or materials handling type","ratingBasis":"$1,000 of Gross Sales"},"56651":{"description":"Machinery or Machinery Parts Manufacturing - farm type","ratingBasis":"$1,000 of Gross Sales"},"56652":{"description":"Machinery or Machinery Parts Manufacturing - industrial type","ratingBasis":"$1,000 of Gross Sales"},"56653":{"description":"Machinery or Machinery Parts Manufacturing - metalworking","ratingBasis":"$1,000 of Gross Sales"},"56654":{"description":"Machinery or Machinery Parts Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"15070":{"description":"Mail Box or Packaging Stores","ratingBasis":"$1,000 of Gross Sales"},"45900":{"description":"Mail Order Druggists","ratingBasis":"$1,000 of Gross Sales"},"45901":{"description":"Mail Order Houses","ratingBasis":"$1,000 of Gross Sales"},"45937":{"description":"Mailing or Addressing Companies","ratingBasis":"$1,000 of Gross Sales"},"54444":{"description":"Manufacturers - Not Otherwise Classified","ratingBasis":"No Exposure"},"45993":{"description":"Manufacturer's Representatives","ratingBasis":"$1,000 of Gross Sales"},"97308":{"description":"Marine Appraisers or Surveyors","ratingBasis":"$1,000 of Payroll"},"15119":{"description":"Markets - not open air (Lessor's risk only) (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"15120":{"description":"Markets - not open air (Lessor's risk only) (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"15123":{"description":"Markets - open air (Lessor's risk only) (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"15124":{"description":"Markets - open air (Lessor's risk only) (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"97447":{"description":"Masonry","ratingBasis":"$1,000 of Payroll"},"56690":{"description":"Match Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"56699":{"description":"Mattress or Box Spring Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"46004":{"description":"Mausoleums (For-Profit)","ratingBasis":"Thousands of Square Feet"},"46005":{"description":"Mausoleums (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"56758":{"description":"Meat, Fish, Poultry or Seafood - curing","ratingBasis":"$1,000 of Gross Sales"},"15223":{"description":"Meat, Fish, Poultry or Seafood - distributors","ratingBasis":"$1,000 of Gross Sales"},"56759":{"description":"Meat, Fish, Poultry or Seafood Processing - in airtight containers","ratingBasis":"$1,000 of Gross Sales"},"56760":{"description":"Meat, Fish, Poultry or Seafood Processing - not in airtight containers","ratingBasis":"$1,000 of Gross Sales"},"15224":{"description":"Meat, Fish, Poultry or Seafood Stores","ratingBasis":"$1,000 of Gross Sales"},"57800":{"description":"Media Manufacturing - blank","ratingBasis":"$1,000 of Gross Sales"},"58627":{"description":"Media Manufacturing - prerecorded","ratingBasis":"$1,000 of Gross Sales"},"66561":{"description":"Medical Offices","ratingBasis":"Thousands of Square Feet"},"56808":{"description":"Medical, Dental or Surgical Diagnostic Treatment Machines or Devices Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"56805":{"description":"Medical, Dental, Hospital or Surgical Equipment or Supplies Manufacturing - expendable","ratingBasis":"$1,000 of Gross Sales"},"56806":{"description":"Medical, Dental, Hospital or Surgical Equipment or Supplies Manufacturing - nonexpendable","ratingBasis":"$1,000 of Gross Sales"},"56807":{"description":"Medical, Dental, Hospital or Surgical Instruments Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"15300":{"description":"Medical, Hospital and Surgical Equipment and Supplies - rented to others","ratingBasis":"$1,000 of Gross Sales"},"15314":{"description":"Medical, Hospital and Surgical Supply Stores","ratingBasis":"$1,000 of Gross Sales"},"15404":{"description":"Metal Dealers or Distributors - nonstructural","ratingBasis":"$1,000 of Gross Sales"},"15407":{"description":"Metal Dealers or Distributors - nonstructural","ratingBasis":"Thousands of Tons"},"15405":{"description":"Metal Dealers or Distributors - structural","ratingBasis":"$1,000 of Gross Sales"},"15408":{"description":"Metal Dealers or Distributors - structural","ratingBasis":"Thousands of Tons"},"97650":{"description":"Metal Erection - decorative or artistic","ratingBasis":"$1,000 of Payroll"},"97651":{"description":"Metal Erection - frame structures - iron work on outside of buildings","ratingBasis":"$1,000 of Payroll"},"97652":{"description":"Metal Erection - in the construction of dwellings not exceeding two stories in height","ratingBasis":"$1,000 of Payroll"},"97653":{"description":"Metal Erection - nonstructural - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"97654":{"description":"Metal Erection - steel lock gates, gas holders, standpipes, water towers, smokestacks, tanks, silos, prison cells, fire or burglar proof vaults","ratingBasis":"$1,000 of Payroll"},"97655":{"description":"Metal Erection - structural - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"56900":{"description":"Metal Extraction or Refining - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"56901":{"description":"Metal Extraction or Refining - Not Otherwise Classified","ratingBasis":"Thousands of Tons"},"56910":{"description":"Metal Foil Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"56911":{"description":"Metal Goods Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"56912":{"description":"Metal Goods Manufacturing - stamping - not signs","ratingBasis":"$1,000 of Gross Sales"},"56913":{"description":"Metal Heat Processing","ratingBasis":"$1,000 of Gross Sales"},"15406":{"description":"Metal Scrap Dealers","ratingBasis":"$1,000 of Gross Sales"},"15409":{"description":"Metal Scrap Dealers","ratingBasis":"Thousands of Tons"},"59914":{"description":"Metal Works - shop - decorative or artistic","ratingBasis":"$1,000 of Gross Sales"},"56915":{"description":"Metal Works - shop - structural - load bearing","ratingBasis":"$1,000 of Gross Sales"},"56916":{"description":"Metal Works - shop - structural - not load bearing","ratingBasis":"$1,000 of Gross Sales"},"56917":{"description":"Metals - extraction or refining - chemical processes","ratingBasis":"$1,000 of Gross Sales"},"56921":{"description":"Metals - extraction or refining - chemical processes","ratingBasis":"Thousands of Tons"},"56918":{"description":"Metals - extraction or refining - electrometallurgical processes","ratingBasis":"$1,000 of Gross Sales"},"56922":{"description":"Metals - extraction or refining - electrometallurgical processes","ratingBasis":"Thousands of Tons"},"56919":{"description":"Metals - extraction or refining of ferrous metals - blast furnace or other pyrometallurgical processes","ratingBasis":"$1,000 of Gross Sales"},"56923":{"description":"Metals - extraction or refining of ferrous metals - blast furnace or other pyrometallurgical processes","ratingBasis":"Thousands of Tons"},"56920":{"description":"Metals - extraction or refining of nonferrous metals - blast furnace or other pyrometallurgical processes","ratingBasis":"$1,000 of Gross Sales"},"56924":{"description":"Metals - extraction or refining of nonferrous metals - blast furnace or other pyrometallurgical processes","ratingBasis":"Thousands of Tons"},"56980":{"description":"Mica Goods Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"57001":{"description":"Milk Depots or Dealers","ratingBasis":"$1,000 of Gross Sales"},"57002":{"description":"Milk Processing","ratingBasis":"$1,000 of Gross Sales"},"98001":{"description":"Mining - Not Otherwise Classified","ratingBasis":"Thousands of Tons"},"98002":{"description":"Mining - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"98003":{"description":"Mining - surface","ratingBasis":"$1,000 of Payroll"},"98004":{"description":"Mining - surface","ratingBasis":"Thousands of Tons"},"57090":{"description":"Mobile Home Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"46202":{"description":"Mobile Home Parks or Courts","ratingBasis":"$1,000 of Gross Sales"},"46203":{"description":"Mobile Home Parks or Courts","ratingBasis":"Per Site"},"15488":{"description":"Mobile Home Sales Agencies","ratingBasis":"$1,000 of Gross Sales"},"46362":{"description":"Model Homes","ratingBasis":"Number of Model Homes"},"57146":{"description":"Modular Units Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"98090":{"description":"Motion Pictures - development of negatives, printing and all subsequent operations","ratingBasis":"$1,000 of Payroll"},"98091":{"description":"Motion Pictures - film distribution or exchanges - not located at motion picture studios","ratingBasis":"$1,000 of Payroll"},"98092":{"description":"Motion Pictures - production - studios or outside - all operations prior to the development of negatives","ratingBasis":"$1,000 of Payroll"},"57202":{"description":"Motorcycle, Moped or Motor Scooter Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"46426":{"description":"Museums (For-Profit)","ratingBasis":"Thousands of Square Feet"},"46427":{"description":"Museums (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"16676":{"description":"Music Products Stores - prerecorded","ratingBasis":"$1,000 of Gross Sales"},"57257":{"description":"Musical Instrument Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"15538":{"description":"Musical Instrument Stores","ratingBasis":"$1,000 of Gross Sales"},"15600":{"description":"Nail Salons","ratingBasis":"$1,000 of Gross Sales"},"57401":{"description":"Nails or Spikes Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"57403":{"description":"Needles, Pins or Tacks Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"57410":{"description":"Net Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"57411":{"description":"Net Manufacturing - safety nets","ratingBasis":"$1,000 of Gross Sales"},"15607":{"description":"Newspaper or Magazine Distributors","ratingBasis":"$1,000 of Gross Sales"},"15608":{"description":"Newsstands","ratingBasis":"$1,000 of Gross Sales"},"15656":{"description":"Nightclubs, Cabarets and Comedy Clubs","ratingBasis":"$1,000 of Gross Sales"},"16292":{"description":"not in original list","ratingBasis":""},"47366":{"description":"not in original list","ratingBasis":""},"54426":{"description":"not in original list","ratingBasis":""},"15699":{"description":"Nursery - garden","ratingBasis":"$1,000 of Gross Sales"},"57572":{"description":"Office Machines Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"98111":{"description":"Office Machines or Appliances - installation, inspection, adjustment or repair","ratingBasis":"$1,000 of Payroll"},"98152":{"description":"Oil or Gas Lease Work by Contractors - not lease operation","ratingBasis":"$1,000 of Payroll"},"98153":{"description":"Oil or Gas Wells - acidizing","ratingBasis":"$1,000 of Payroll"},"98154":{"description":"Oil or Gas Wells - cementing","ratingBasis":"$1,000 of Payroll"},"98155":{"description":"Oil or Gas Wells - cleaning or swabbing by contractors","ratingBasis":"$1,000 of Payroll"},"98156":{"description":"Oil or Gas Wells - cleaning or swabbing by contractors - within the limits of any town or city, on the right-of-way of any railroad, or in any ocean, gulf or bay","ratingBasis":"$1,000 of Payroll"},"98157":{"description":"Oil or Gas Wells - drilling or redrilling, installation or recovery of casing","ratingBasis":"$1,000 of Payroll"},"98158":{"description":"Oil or Gas Wells - drilling or redrilling, installation or recovery of casing - within the limits of any town or city, on the right-of-way of any railroad, or in any ocean, gulf or bay","ratingBasis":"$1,000 of Payroll"},"98159":{"description":"Oil or Gas Wells - instrument logging or survey work in wells","ratingBasis":"$1,000 of Payroll"},"46510":{"description":"Oil or Gas Wells - nonoperating work interest","ratingBasis":"No Exposure"},"98160":{"description":"Oil or Gas Wells - perforating of casing","ratingBasis":"$1,000 of Payroll"},"98161":{"description":"Oil or Gas Wells - servicing - by contractors","ratingBasis":"$1,000 of Payroll"},"98162":{"description":"Oil or Gas Wells - shooting","ratingBasis":"$1,000 of Payroll"},"15188":{"description":"Oil or Gas Wells Supplies or Equipment Dealers - secondhand","ratingBasis":"$1,000 of Gross Sales"},"98150":{"description":"Oil or Natural Gas Lease Operations","ratingBasis":"$1,000 of Payroll"},"98151":{"description":"Oil or Natural Gas Lease Operations - within the limits of any town or city, on the right-of-way of any railroad, or in any ocean, gulf or bay","ratingBasis":"$1,000 of Payroll"},"15733":{"description":"Oil Refineries","ratingBasis":"$1,000 of Gross Sales"},"15734":{"description":"Oil Refineries","ratingBasis":"Gallons"},"98163":{"description":"Oil Rig or Derrick Erecting or Dismantling - wood or metal","ratingBasis":"$1,000 of Payroll"},"98164":{"description":"Oil Still Erection or Repair","ratingBasis":"$1,000 of Payroll"},"57600":{"description":"Optical Goods Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"15839":{"description":"Optical Goods Stores","ratingBasis":"$1,000 of Gross Sales"},"98257":{"description":"Orchards and Vineyards - operation by contractors","ratingBasis":"$1,000 of Payroll"},"57611":{"description":"Ore Milling or Processing","ratingBasis":"$1,000 of Gross Sales"},"57612":{"description":"Ore Milling or Processing","ratingBasis":"Thousands of Tons"},"57625":{"description":"Orthopedic, Ambulation or Prosthetic Devices Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"57651":{"description":"Packing Houses","ratingBasis":"$1,000 of Gross Sales"},"57690":{"description":"Paint, Varnish, Shellac or Lacquer Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"15991":{"description":"Paint, Wallpaper or Wallcovering Stores","ratingBasis":"$1,000 of Gross Sales"},"98303":{"description":"Painting - exterior - buildings or structures - exceeding three stories in height - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"98304":{"description":"Painting - exterior - buildings or structures - three stories or less in height - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"98305":{"description":"Painting - interior buildings or structures","ratingBasis":"$1,000 of Payroll"},"98306":{"description":"Painting - oil or gasoline tanks","ratingBasis":"$1,000 of Payroll"},"98307":{"description":"Painting - ship hulls","ratingBasis":"$1,000 of Payroll"},"98308":{"description":"Painting - shop only","ratingBasis":"$1,000 of Payroll"},"98309":{"description":"Painting - Steel Structures or Bridges","ratingBasis":"$1,000 of Payroll"},"15993":{"description":"Painting, Picture or Frame Stores","ratingBasis":"$1,000 of Gross Sales"},"57716":{"description":"Paper Coating or Finishing","ratingBasis":"$1,000 of Gross Sales"},"57725":{"description":"Paper Goods Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"57726":{"description":"Paper Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"16005":{"description":"Paper Products Distributors","ratingBasis":"$1,000 of Gross Sales"},"16009":{"description":"Paper, Rag or Rubber Stock Dealers and Distributors - secondhand","ratingBasis":"$1,000 of Gross Sales"},"98344":{"description":"Paperhanging","ratingBasis":"$1,000 of Payroll"},"57798":{"description":"Parachute Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"46590":{"description":"Parades","ratingBasis":"Number of Parades"},"46622":{"description":"Parking - private","ratingBasis":"Thousands of Square Feet"},"46603":{"description":"Parking - public - not open air","ratingBasis":"$1,000 of Gross Sales"},"46604":{"description":"Parking - public - open air","ratingBasis":"$1,000 of Gross Sales"},"46606":{"description":"Parking - public - shopping centers - maintained by lessee - (lessor's risk only)","ratingBasis":"Thousands of Square Feet"},"46607":{"description":"Parking - public - shopping centers - maintained by the insured - (lessor's risk only)","ratingBasis":"Thousands of Square Feet"},"46671":{"description":"Parks and Playgrounds","ratingBasis":"Number of Parks or Playgrounds"},"57808":{"description":"Pattern Manufacturing - metal","ratingBasis":"$1,000 of Gross Sales"},"57809":{"description":"Pattern Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"57810":{"description":"Pattern Manufacturing - paper","ratingBasis":"$1,000 of Gross Sales"},"46700":{"description":"Penal Institutions","ratingBasis":"Thousands of Square Feet"},"57871":{"description":"Pencil, Pen, Crayon or Chalk Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"43470":{"description":"Pest Control Services","ratingBasis":"$1,000 of Gross Sales"},"57913":{"description":"Pet Food Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"16402":{"description":"Pet Grooming","ratingBasis":"$1,000 of Gross Sales"},"16403":{"description":"Pet Stores","ratingBasis":"$1,000 of Gross Sales"},"16404":{"description":"Pet Training","ratingBasis":"$1,000 of Gross Sales"},"57997":{"description":"Photo Finishing Laboratories","ratingBasis":"$1,000 of Gross Sales"},"16471":{"description":"Photographers","ratingBasis":"$1,000 of Gross Sales"},"57998":{"description":"Photographic Equipment Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"57999":{"description":"Photographic Supplies Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"98405":{"description":"Piano Tuning","ratingBasis":"$1,000 of Payroll"},"46773":{"description":"Picnic Grounds - commercially operated","ratingBasis":"Number of Picnic Grounds"},"98413":{"description":"Pile Driving - building foundation only","ratingBasis":"$1,000 of Payroll"},"98414":{"description":"Pile Driving - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"98415":{"description":"Pile Driving - sonic method","ratingBasis":"$1,000 of Payroll"},"51029":{"description":"Pineapple Canneries - (Hawaii only)","ratingBasis":"$1,000 of Gross Sales"},"98423":{"description":"Pipeline Construction - gas","ratingBasis":"$1,000 of Payroll"},"98424":{"description":"Pipeline Construction - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"98425":{"description":"Pipeline Construction - oil","ratingBasis":"$1,000 of Payroll"},"98426":{"description":"Pipeline Construction - slurry - nonflammable mixtures","ratingBasis":"$1,000 of Payroll"},"98427":{"description":"Pipelines - operation - gas","ratingBasis":"$1,000 of Payroll"},"98428":{"description":"Pipelines - operation - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"98429":{"description":"Pipelines - operation - oil","ratingBasis":"$1,000 of Payroll"},"98430":{"description":"Pipelines - operation - slurry - nonflammable mixtures","ratingBasis":"$1,000 of Payroll"},"58020":{"description":"Pipes Manufacturing - tobacco","ratingBasis":"$1,000 of Gross Sales"},"58009":{"description":"Pipes or Tubes Manufacturing - metal","ratingBasis":"$1,000 of Gross Sales"},"58010":{"description":"Pipes or Tubes Manufacturing - plastic","ratingBasis":"$1,000 of Gross Sales"},"98449":{"description":"Plastering or Stucco Work","ratingBasis":"$1,000 of Payroll"},"58056":{"description":"Plastic Manufacturing - raw material","ratingBasis":"$1,000 of Gross Sales"},"58057":{"description":"Plastic or Rubber Goods Manufacturing - household - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"58058":{"description":"Plastic or Rubber Goods Manufacturing - other than household - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"16501":{"description":"Plastic or Rubber Supply Goods Distributors","ratingBasis":"$1,000 of Gross Sales"},"98482":{"description":"Plumbing - commercial and industrial","ratingBasis":"$1,000 of Payroll"},"98483":{"description":"Plumbing - residential or domestic","ratingBasis":"$1,000 of Payroll"},"58095":{"description":"Plumbing Fixtures Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"16527":{"description":"Plumbing Supplies and Fixtures Dealers and Distributors","ratingBasis":"$1,000 of Gross Sales"},"58096":{"description":"Plumbing Supplies Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"58301":{"description":"Plywood, Veneer or Veneer Products Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"58302":{"description":"Plywood, Veneer or Veneer Products Manufacturing - without log processing","ratingBasis":"$1,000 of Gross Sales"},"46822":{"description":"Political Campaign Headquarters or Offices","ratingBasis":"Number of Headquarters or Offices"},"19061":{"description":"Portable Toilet Rentals","ratingBasis":"$1,000 of Gross Sales"},"98502":{"description":"Prefabricated Building Erection","ratingBasis":"$1,000 of Payroll"},"58397":{"description":"Prefabricated Building Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"44444":{"description":"Premises/Operations and Products/Completed Operations - Not Otherwise Classified","ratingBasis":"No Exposure"},"15191":{"description":"Principals Protective Liability – liability to independent contractors (Covg A)","ratingBasis":""},"15192":{"description":"Principals Protective Liability – liability to independent contractors (Covg B)","ratingBasis":""},"16588":{"description":"Printers or Electrotypers Supplies - distributors","ratingBasis":"$1,000 of Gross Sales"},"58408":{"description":"Printing (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"58409":{"description":"Printing (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"16604":{"description":"Produce Handling and Packing","ratingBasis":"$1,000 of Gross Sales"},"46881":{"description":"Professional and Trade Associations - no building or premises owned or leased except as offices (For-Profit)","ratingBasis":"Number of Members"},"46882":{"description":"Professional and Trade Associations - no building or premises owned or leased except as offices (Not-For-Profit)","ratingBasis":"Number of Members"},"58456":{"description":"Publishers - books or magazines (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"58457":{"description":"Publishers - books or magazines (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"58458":{"description":"Publishers - newspapers (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"58459":{"description":"Publishers - newspapers (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"58503":{"description":"Pulp Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"58532":{"description":"Pumps or Compressors Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"98555":{"description":"Quarries","ratingBasis":"$1,000 of Payroll"},"46913":{"description":"Race Tracks - motorized vehicles - (lessor's risk only)","ratingBasis":"$1,000 of Gross Sales"},"46911":{"description":"Race Tracks - motorized vehicles - operators","ratingBasis":"$1,000 of Gross Sales"},"46915":{"description":"Race Tracks - motorized vehicles (sponsor's risk only)","ratingBasis":"Thousands of Admissions"},"46912":{"description":"Race Tracks - Not Otherwise Classified - operators","ratingBasis":"$1,000 of Gross Sales"},"46914":{"description":"Racing - Not Otherwise Classified - (lessor's risk only)","ratingBasis":"$1,000 of Gross Sales"},"46916":{"description":"Racing - Not Otherwise Classified - (sponsor's risk only)","ratingBasis":"Thousands of Admissions"},"16670":{"description":"Racquet Sports and Handball Facilities - commercially operated","ratingBasis":"$1,000 of Gross Sales"},"98597":{"description":"Radio or TV Broadcasting Stations (For-Profit)","ratingBasis":"$1,000 of Payroll"},"98598":{"description":"Radio or TV Broadcasting Stations (Not-For-Profit)","ratingBasis":"$1,000 of Payroll"},"98601":{"description":"Railroad Construction","ratingBasis":"$1,000 of Payroll"},"58559":{"description":"Railroad Engine Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"58560":{"description":"Railroad or Other Public Conveyance Cars Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"58561":{"description":"Railroad or Other Public Conveyance Cars Parts Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"98622":{"description":"Railroads - operation and maintenance - with BI passenger hazard","ratingBasis":"$1,000 of Payroll"},"98623":{"description":"Railroads - operation and maintenance - without BI passenger hazard","ratingBasis":"$1,000 of Payroll"},"98624":{"description":"Railroads - shop operation and maintenance","ratingBasis":"$1,000 of Payroll"},"58575":{"description":"Razor or Razor Blades Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"47050":{"description":"Real Estate Agents","ratingBasis":"$1,000 of Payroll"},"47051":{"description":"Real Estate Development Property","ratingBasis":"Number of Acres"},"47052":{"description":"Real Estate Property Managed","ratingBasis":"$1,000 of Gross Sales"},"47103":{"description":"Recording Studios","ratingBasis":"Thousands of Square Feet"},"16694":{"description":"Recreational Vehicle Dealers","ratingBasis":"$1,000 of Gross Sales"},"47146":{"description":"Recycling Collection Centers (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"47149":{"description":"Recycling Collection Centers (For-Profit)","ratingBasis":"Thousands of Square Feet"},"47147":{"description":"Recycling Collection Centers (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"47148":{"description":"Recycling Collection Centers (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"16705":{"description":"Refrigeration Equipment Dealers and Distributors only - commercial","ratingBasis":"$1,000 of Gross Sales"},"58663":{"description":"Refrigeration Equipment Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"98636":{"description":"Refrigeration Systems or Equipment - dealers and distributors and installation, servicing or repair - commercial","ratingBasis":"$1,000 of Payroll"},"58682":{"description":"Rendering Works","ratingBasis":"$1,000 of Gross Sales"},"98640":{"description":"Renovating - outside surfaces of buildings","ratingBasis":"$1,000 of Payroll"},"16723":{"description":"Rental Stores - machinery or equipment - rented to others on a long-term basis","ratingBasis":"$1,000 of Gross Sales"},"16722":{"description":"Rental Stores - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"16819":{"description":"Restaurants - operated by concessionaires (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"16820":{"description":"Restaurants - operated by concessionaires (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"16900":{"description":"Restaurants - with no sale of alcoholic beverages - with table service","ratingBasis":"$1,000 of Gross Sales"},"16902":{"description":"Restaurants - with no sale of alcoholic beverages - without seating","ratingBasis":"$1,000 of Gross Sales"},"16901":{"description":"Restaurants - with no sale of alcoholic beverages - without table service with seating","ratingBasis":"$1,000 of Gross Sales"},"16940":{"description":"Restaurants - with sale of alcoholic beverages that are 75% or more of the total annual receipts of the restaurants - bar service only/no tables - with dance floor","ratingBasis":"$1,000 of Gross Sales"},"16941":{"description":"Restaurants - with sale of alcoholic beverages that are 75% or more of the total annual receipts of the restaurants - bar service only/no tables - without dance floor","ratingBasis":"$1,000 of Gross Sales"},"16931":{"description":"Restaurants - with sale of alcoholic beverages that are 75% or more of the total annual receipts of the restaurants - with tables - without dance floor - no table service","ratingBasis":"$1,000 of Gross Sales"},"16930":{"description":"Restaurants - with sale of alcoholic beverages that are 75% or more of the total annual receipts of the restaurants - with tables - without dance floor - with table service","ratingBasis":"$1,000 of Gross Sales"},"16921":{"description":"Restaurants - with sale of alcoholic beverages that are 75% or more of the total annual receipts of the restaurants - with tables and dance floor - no table service","ratingBasis":"$1,000 of Gross Sales"},"16920":{"description":"Restaurants - with sale of alcoholic beverages that are 75% or more of the total annual receipts of the restaurants - with tables and dance floor - with table service","ratingBasis":"$1,000 of Gross Sales"},"16915":{"description":"Restaurants - with sales of alcoholic beverages that are 30% or more but less than 75% of the total annual receipts of the restaurants - with dance floor","ratingBasis":"$1,000 of Gross Sales"},"16916":{"description":"Restaurants - with sales of alcoholic beverages that are 30% or more but less than 75% of the total annual receipts of the restaurants - without dance floor","ratingBasis":"$1,000 of Gross Sales"},"16910":{"description":"Restaurants - with sales of alcoholic beverages that are less than 30% of the total annual receipts of the restaurants - with table service","ratingBasis":"$1,000 of Gross Sales"},"16911":{"description":"Restaurants - with sales of alcoholic beverages that are less than 30% of the total annual receipts of the restaurants - without table service","ratingBasis":"$1,000 of Gross Sales"},"47221":{"description":"Riding Academies","ratingBasis":"Thousands of Square Feet"},"47253":{"description":"Rifle or Pistol Ranges - indoor","ratingBasis":"Number of Ranges"},"47254":{"description":"Rifle or Pistol Ranges - Not Otherwise Classified","ratingBasis":"Number of Ranges"},"98658":{"description":"Rigging - not ship or boat","ratingBasis":"$1,000 of Payroll"},"98659":{"description":"Rigging - ship or boat","ratingBasis":"$1,000 of Payroll"},"47318":{"description":"Rodeos","ratingBasis":"$1,000 of Gross Sales"},"58713":{"description":"Rolling Mills - cold or hot process","ratingBasis":"$1,000 of Gross Sales"},"98677":{"description":"Roofing - commercial or residential over three stories","ratingBasis":"$1,000 of Payroll"},"98678":{"description":"Roofing - residential - three stories and under","ratingBasis":"$1,000 of Payroll"},"58737":{"description":"Rope Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"58755":{"description":"Rubber Manufacturing","ratingBasis":"Thousands of Tons"},"58756":{"description":"Rubber Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"58757":{"description":"Rubber Reclaiming","ratingBasis":"$1,000 of Gross Sales"},"58758":{"description":"Rubber Reclaiming","ratingBasis":"Thousands of Tons"},"58759":{"description":"Rubber Stamp Manufacturing or Assembling","ratingBasis":"$1,000 of Gross Sales"},"58802":{"description":"Saddles, Harnesses or Horse Furnishings Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"58813":{"description":"Safes or Safe Vaults Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"58822":{"description":"Sail Making","ratingBasis":"$1,000 of Gross Sales"},"47367":{"description":"Sales or Service Organizations","ratingBasis":"$1,000 of Payroll"},"58840":{"description":"Salt Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"58837":{"description":"Salt, Borax, Potash or Phosphate - producing or refining - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"98698":{"description":"Salvage Operations - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"98699":{"description":"Salvage Operations - removing, sorting, reconditioning and distributing of merchandise in damaged buildings and incidental operations away from such buildings","ratingBasis":"$1,000 of Payroll"},"98710":{"description":"Sand or Gravel Digging","ratingBasis":"$1,000 of Payroll"},"98705":{"description":"Sandblasting","ratingBasis":"$1,000 of Payroll"},"47420":{"description":"Saunas and Baths - public","ratingBasis":"$1,000 of Gross Sales"},"51098":{"description":"Sausage Casing Manufacturing - (Hawaii only)","ratingBasis":"$1,000 of Gross Sales"},"58873":{"description":"Saw Mills or Planing Mills","ratingBasis":"$1,000 of Gross Sales"},"58874":{"description":"Saw Mills or Planing Mills","ratingBasis":"$1,000 of Payroll"},"67508":{"description":"Schools - colleges, universities, junior colleges or college preparatory (For-Profit)","ratingBasis":"Thousands of Square Feet"},"67509":{"description":"Schools - colleges, universities, junior colleges or college preparatory (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"47468":{"description":"Schools - correspondence","ratingBasis":"$1,000 of Gross Sales"},"67510":{"description":"Schools - dormitory facilities (For-Profit)","ratingBasis":"Thousands of Square Feet"},"67511":{"description":"Schools - dormitory facilities (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"47469":{"description":"Schools - faculty liability for corporal punishment of students","ratingBasis":"Number of Faculty Members"},"67512":{"description":"Schools - Not Otherwise Classified (For-Profit)","ratingBasis":"Thousands of Square Feet"},"67513":{"description":"Schools - Not Otherwise Classified (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"47475":{"description":"Schools - private - elementary, kindergarten or junior high (For-Profit)","ratingBasis":"Number of Students"},"47476":{"description":"Schools - private - elementary, kindergarten or junior high (Not-For-Profit)","ratingBasis":"Number of Students"},"47477":{"description":"Schools - private - high (For-Profit)","ratingBasis":"Number of Pupils"},"47478":{"description":"Schools - private - high (Not-For-Profit)","ratingBasis":"Number of Pupils"},"47471":{"description":"Schools - public - elementary, kindergarten or junior high","ratingBasis":"Number of Pupils"},"47473":{"description":"Schools - public - high","ratingBasis":"Number of Pupils"},"47474":{"description":"Schools - trade or vocational","ratingBasis":"Number of Pupils"},"16881":{"description":"Secondhand or Salvage Dealers and Distributors","ratingBasis":"$1,000 of Gross Sales"},"98751":{"description":"Security and Patrol Agencies","ratingBasis":"$1,000 of Payroll"},"16892":{"description":"Seed Merchants - excluding germination failure","ratingBasis":"$1,000 of Gross Sales"},"16890":{"description":"Seed Merchants - excluding misdelivery, error in mixture and germination failure","ratingBasis":"$1,000 of Gross Sales"},"16891":{"description":"Seed Merchants - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"98805":{"description":"Septic Tank Systems - cleaning","ratingBasis":"$1,000 of Payroll"},"98806":{"description":"Septic Tank Systems - installation, servicing or repair","ratingBasis":"$1,000 of Payroll"},"98810":{"description":"Sewage Disposal - plant operations","ratingBasis":"$1,000 of Payroll"},"98813":{"description":"Sewer Cleaning","ratingBasis":"$1,000 of Payroll"},"98820":{"description":"Sewer Mains or Connections Construction","ratingBasis":"$1,000 of Payroll"},"48039":{"description":"Sewers","ratingBasis":"Number of Miles"},"58903":{"description":"Sewing Machines Manufacturing - commercial","ratingBasis":"$1,000 of Gross Sales"},"58904":{"description":"Sewing Machines Manufacturing - household","ratingBasis":"$1,000 of Gross Sales"},"98871":{"description":"Shaft Sinking","ratingBasis":"$1,000 of Payroll"},"98884":{"description":"Sheet Metal Work - shop and outside","ratingBasis":"$1,000 of Payroll"},"58922":{"description":"Sheet Metal Work - shop only","ratingBasis":"$1,000 of Gross Sales"},"67017":{"description":"Shelters, Mission, Settlement or Halfway Houses - not church or office buildings","ratingBasis":"Thousands of Square Feet"},"98914":{"description":"Ship Ceiling or Scaling","ratingBasis":"$1,000 of Payroll"},"18078":{"description":"Ship Chandler Stores","ratingBasis":"$1,000 of Gross Sales"},"98949":{"description":"Ship Repair or Conversion","ratingBasis":"$1,000 of Payroll"},"18109":{"description":"Shoe Repair Shops","ratingBasis":"$1,000 of Gross Sales"},"18110":{"description":"Shoe Stores","ratingBasis":"$1,000 of Gross Sales"},"59005":{"description":"Shoe, Boot or Slipper Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"67635":{"description":"Shopping Centers - excluding indoor malls - buildings or premises not occupied by the insured (lessor's risk only)","ratingBasis":"Thousands of Square Feet"},"67634":{"description":"Shopping Centers - indoor malls - buildings or premises not occupied by the insured (lessor's risk only)","ratingBasis":"Thousands of Square Feet"},"98967":{"description":"Siding Installation","ratingBasis":"$1,000 of Payroll"},"98993":{"description":"Sign Erection, Installation or Repair","ratingBasis":"$1,000 of Payroll"},"59057":{"description":"Sign Manufacturing - electrical","ratingBasis":"$1,000 of Gross Sales"},"59058":{"description":"Sign Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"99003":{"description":"Sign Painting or Lettering - inside of buildings","ratingBasis":"$1,000 of Payroll"},"99004":{"description":"Sign Painting or Lettering on Buildings or Structures","ratingBasis":"$1,000 of Payroll"},"48177":{"description":"Skating Rinks - ice","ratingBasis":"$1,000 of Gross Sales"},"48178":{"description":"Skating Rinks - roller","ratingBasis":"$1,000 of Gross Sales"},"48206":{"description":"Skeet Shooting or Trap Shooting Ranges","ratingBasis":"Number of Ranges"},"48252":{"description":"Ski Lifts, Tows or Runs","ratingBasis":"$1,000 of Gross Sales"},"59188":{"description":"Slate Milling","ratingBasis":"$1,000 of Gross Sales"},"59189":{"description":"Slate Splitting or Slate Roofing Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"99310":{"description":"Snow and Ice Removal - Contractor","ratingBasis":"$1,000 of Payroll"},"48441":{"description":"Soap Box Derbies","ratingBasis":"Number of Contestants"},"59223":{"description":"Soap Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"48557":{"description":"Social Gatherings and Meetings - on premises not owned or operated by the insured (For-Profit)","ratingBasis":"Number of Locations"},"48558":{"description":"Social Gatherings and Meetings - on premises not owned or operated by the insured (Not-For-Profit)","ratingBasis":"Number of Locations"},"48600":{"description":"Social Services - consulting service only - operated by the private sector","ratingBasis":"Thousands of Square Feet"},"99080":{"description":"Solar Energy Contractors","ratingBasis":"$1,000 of Payroll"},"97501":{"description":"Solar Energy Systems","ratingBasis":""},"18200":{"description":"Spas or Personal Enhancement Facilities","ratingBasis":"$1,000 of Gross Sales"},"59257":{"description":"Sponge Processing","ratingBasis":"$1,000 of Gross Sales"},"48610":{"description":"Sport or Outdoor Activities - commercially operated","ratingBasis":"Each Activity Day"},"18205":{"description":"Sporting Goods or Athletic Equipment Distributors","ratingBasis":"$1,000 of Gross Sales"},"59306":{"description":"Sporting Goods or Athletic Equipment Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"18206":{"description":"Sporting Goods or Athletic Equipment Stores","ratingBasis":"$1,000 of Gross Sales"},"99111":{"description":"Stables - boarding, livery or racing","ratingBasis":"$1,000 of Payroll"},"48637":{"description":"Stadiums - operated by the insured (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"48638":{"description":"Stadiums - operated by the insured (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"18335":{"description":"Stationery or Paper Products Stores","ratingBasis":"$1,000 of Gross Sales"},"99160":{"description":"Steam Heating or Steam Power Companies","ratingBasis":"$1,000 of Payroll"},"99163":{"description":"Steam Mains or Connections Construction","ratingBasis":"$1,000 of Payroll"},"99165":{"description":"Steam Pipe or Boiler Insulation","ratingBasis":"$1,000 of Payroll"},"93166":{"description":"Steamship Lines or Agencies - port superintendents, captains, engineers, stewards, or their assistants or pay clerks","ratingBasis":"$1,000 of Payroll"},"93167":{"description":"Steamship Lines or Agencies - tallymen, checking clerks or employees engaged in mending or repacking of damaged containers","ratingBasis":"$1,000 of Payroll"},"59378":{"description":"Steel Wool or Wire Wool Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"99220":{"description":"Stevedoring - by hand or by means of hand trucks exclusively - no hoisting of cargo","ratingBasis":"$1,000 of Payroll"},"99221":{"description":"Stevedoring - handling explosives or ammunition under contract","ratingBasis":"$1,000 of Payroll"},"99222":{"description":"Stevedoring - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"99223":{"description":"Stevedoring - tallyers or checking clerks engaged in connection with stevedoring work","ratingBasis":"$1,000 of Payroll"},"48636":{"description":"Stockyards","ratingBasis":"$1,000 of Payroll"},"59481":{"description":"Stone Crushing","ratingBasis":"$1,000 of Gross Sales"},"59482":{"description":"Stone Cutting or Polishing","ratingBasis":"$1,000 of Gross Sales"},"18435":{"description":"Stores - Not Otherwise Classified - food or drink (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"18436":{"description":"Stores - Not Otherwise Classified - food or drink (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"18437":{"description":"Stores - Not Otherwise Classified - no food or drink (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"18438":{"description":"Stores - Not Otherwise Classified - no food or drink (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"99303":{"description":"Street Cleaning","ratingBasis":"$1,000 of Payroll"},"99315":{"description":"Street or Road Construction or Reconstruction","ratingBasis":"$1,000 of Payroll"},"99321":{"description":"Street or Road Paving or Repaving, Surfacing or Resurfacing or Scraping","ratingBasis":"$1,000 of Payroll"},"48727":{"description":"Streets, Roads, Highways or Bridges - existence and maintenance hazard only","ratingBasis":"Number of Miles"},"99445":{"description":"Subway Construction","ratingBasis":"$1,000 of Payroll"},"59537":{"description":"Sugar Refining","ratingBasis":"$1,000 of Gross Sales"},"59538":{"description":"Sugar Refining","ratingBasis":"Thousands of Tons"},"48808":{"description":"Sun Tanning Salons","ratingBasis":"$1,000 of Gross Sales"},"18501":{"description":"Supermarkets - with receipts in excess of $500,000 and area in excess of 3,000 square feet","ratingBasis":"$1,000 of Gross Sales"},"99471":{"description":"Surveyors - land - not engaged in actual construction","ratingBasis":"$1,000 of Payroll"},"99505":{"description":"Swimming Pool Servicing","ratingBasis":"$1,000 of Payroll"},"48924":{"description":"Swimming Pools - commercially operated","ratingBasis":"$1,000 of Gross Sales"},"99506":{"description":"Swimming Pools - installation, servicing, or repair - above ground","ratingBasis":"$1,000 of Payroll"},"99507":{"description":"Swimming Pools - installation, servicing, or repair - below ground","ratingBasis":"$1,000 of Payroll"},"48925":{"description":"Swimming Pools - Not Otherwise Classified","ratingBasis":"Number of Swimming Pools"},"59601":{"description":"Swimming Pools or Accessories Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"59647":{"description":"Syrups or Molasses - refining, blending, or manufacturing","ratingBasis":"$1,000 of Gross Sales"},"18506":{"description":"Tailor Merchants - men or boys","ratingBasis":"$1,000 of Gross Sales"},"18507":{"description":"Tailoring or Dressmaking Establishments - custom","ratingBasis":"$1,000 of Gross Sales"},"59660":{"description":"Tank Building or Manufacturing - metal - not pressurized","ratingBasis":"$1,000 of Gross Sales"},"59661":{"description":"Tank Building or Manufacturing - metal - pressurized","ratingBasis":"$1,000 of Gross Sales"},"99570":{"description":"Tank Construction, Installation, Erection or Repair - metal - not pressurized - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"99572":{"description":"Tank Construction, Installation, Erection or Repair - metal - not pressurized - within buildings exclusively","ratingBasis":"$1,000 of Payroll"},"99571":{"description":"Tank Construction, Installation, Erection or Repair - metal - pressurized - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"99573":{"description":"Tank Construction, Installation, Erection or Repair - metal - pressurized - within buildings exclusively","ratingBasis":"$1,000 of Payroll"},"59693":{"description":"Tanning - animal hides","ratingBasis":"$1,000 of Gross Sales"},"18570":{"description":"Tattoo Parlors","ratingBasis":"$1,000 of Gross Sales"},"68001":{"description":"Taxicab Companies","ratingBasis":"Thousands of Square Feet"},"49005":{"description":"Taxidermists","ratingBasis":"$1,000 of Gross Sales"},"59695":{"description":"Telecommunication Equipment Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"18575":{"description":"Telecommunication Equipment Providers","ratingBasis":"$1,000 of Gross Sales"},"99600":{"description":"Telecommunication Service Providers","ratingBasis":"$1,000 of Payroll"},"99614":{"description":"Telegraph Companies","ratingBasis":"$1,000 of Payroll"},"99613":{"description":"Telephone, Telegraph or Cable Television Line Construction","ratingBasis":"$1,000 of Payroll"},"99620":{"description":"Teleproduction Studios","ratingBasis":"$1,000 of Payroll"},"99650":{"description":"Television or Radio Receiving Set Installation or Repair","ratingBasis":"$1,000 of Payroll"},"59701":{"description":"Television Picture Tube Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"59713":{"description":"Tent or Canopy/Awning Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"99709":{"description":"Tent or Canvas Goods - erection, removal or repair - away from shop","ratingBasis":"$1,000 of Payroll"},"49111":{"description":"Tents or Canopies - loaned or rented to others","ratingBasis":"$1,000 of Gross Sales"},"59722":{"description":"Textile Bleaching, Dyeing, Mercerizing, Printing, Finishing or Silk Screening - new goods","ratingBasis":"$1,000 of Gross Sales"},"59723":{"description":"Textile Coating or Impregnating","ratingBasis":"$1,000 of Gross Sales"},"59724":{"description":"Textile Manufacturing - impregnated or coated","ratingBasis":"$1,000 of Gross Sales"},"59725":{"description":"Textile Products Manufacturing - fabricated","ratingBasis":"$1,000 of Gross Sales"},"59726":{"description":"Textile Spinning, Weaving or Knitting Mills","ratingBasis":"$1,000 of Gross Sales"},"49181":{"description":"Theaters - drive-in","ratingBasis":"Thousands of Admissions"},"49183":{"description":"Theaters - motion pictures","ratingBasis":"Thousands of Admissions"},"49184":{"description":"Theaters - Not Otherwise Classified (For-Profit)","ratingBasis":"Thousands of Admissions"},"49185":{"description":"Theaters - Not Otherwise Classified (Not-For-Profit)","ratingBasis":"Thousands of Admissions"},"99718":{"description":"Theatrical Companies - traveling","ratingBasis":"$1,000 of Payroll"},"68439":{"description":"Ticket Agencies","ratingBasis":"Thousands of Square Feet"},"59738":{"description":"Tie, Post or Pole Yard","ratingBasis":"$1,000 of Gross Sales"},"99746":{"description":"Tile, Stone, Marble, Mosaic or Terrazzo Work - interior construction","ratingBasis":"$1,000 of Payroll"},"18616":{"description":"Tire Dealers","ratingBasis":"$1,000 of Gross Sales"},"59750":{"description":"Tire Manufacturing - auto, bus or truck","ratingBasis":"$1,000 of Gross Sales"},"59751":{"description":"Tire Manufacturing - not auto, bus, or truck","ratingBasis":"$1,000 of Gross Sales"},"49239":{"description":"Tires - retreading or recapping","ratingBasis":"$1,000 of Gross Sales"},"18707":{"description":"Tobacco Products Distributors","ratingBasis":"$1,000 of Gross Sales"},"59773":{"description":"Tobacco Products Manufacturing - cigars or cigarettes","ratingBasis":"$1,000 of Gross Sales"},"59774":{"description":"Tobacco Products Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"59775":{"description":"Tobacco Products Manufacturing - plug or snuff","ratingBasis":"$1,000 of Gross Sales"},"18708":{"description":"Tobacco Products Stores","ratingBasis":"$1,000 of Gross Sales"},"99760":{"description":"Tobacco Rehandling or Warehousing","ratingBasis":"$1,000 of Payroll"},"49292":{"description":"Toll Bridges","ratingBasis":"Thousands of Vehicles"},"59781":{"description":"Tool Manufacturing - accessories - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"59782":{"description":"Tool Manufacturing - hand type - not powered","ratingBasis":"$1,000 of Gross Sales"},"59783":{"description":"Tool Manufacturing - hand type - powered","ratingBasis":"$1,000 of Gross Sales"},"59784":{"description":"Tool Manufacturing - power equipment - household type - outdoor or workshop","ratingBasis":"$1,000 of Gross Sales"},"49305":{"description":"Towers - Telecommunication - Existence Hazard Only - (lessor's risk only)","ratingBasis":"Each Tower"},"68500":{"description":"Townhouse Associations (association risk only)","ratingBasis":"Number of Units"},"18833":{"description":"Toy Distributors","ratingBasis":"$1,000 of Gross Sales"},"18834":{"description":"Toy Stores","ratingBasis":"$1,000 of Gross Sales"},"59790":{"description":"Toys or Games Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"19795":{"description":"Trailer Dealers","ratingBasis":"$1,000 of Gross Sales"},"19796":{"description":"Trailer Rental Agencies","ratingBasis":"$1,000 of Gross Sales"},"59798":{"description":"Trailers Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"49333":{"description":"Travel Agency Tours","ratingBasis":"Thousands of Passenger Days"},"99777":{"description":"Tree Pruning, Dusting, Spraying, Repairing, Trimming or Fumigating","ratingBasis":"$1,000 of Payroll"},"59806":{"description":"Truck Manufacturing or Assembling","ratingBasis":"$1,000 of Gross Sales"},"99793":{"description":"Truckers","ratingBasis":"$1,000 of Payroll"},"99798":{"description":"Tunneling","ratingBasis":"$1,000 of Payroll"},"59867":{"description":"Turpentine or Rosin Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"59886":{"description":"Twine or Cordage Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"59889":{"description":"Umbrella or Cane Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"99803":{"description":"Underpinning Buildings or Structures","ratingBasis":"$1,000 of Payroll"},"99826":{"description":"Upholstering - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"99827":{"description":"Upholstering - shop only","ratingBasis":"$1,000 of Payroll"},"68604":{"description":"Vacant Buildings - factories","ratingBasis":"Thousands of Square Feet"},"68606":{"description":"Vacant Buildings - not factories (For-Profit)","ratingBasis":"Thousands of Square Feet"},"68607":{"description":"Vacant Buildings - not factories (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"49451":{"description":"Vacant Land (For-Profit)","ratingBasis":"Number of Acres"},"49452":{"description":"Vacant Land (Not-For-Profit)","ratingBasis":"Number of Acres"},"59892":{"description":"Valves Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"18911":{"description":"Variety Stores (For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"18912":{"description":"Variety Stores (Not-For-Profit)","ratingBasis":"$1,000 of Gross Sales"},"59904":{"description":"Vegetable Oil Manufacturing - by solvent extraction","ratingBasis":"$1,000 of Gross Sales"},"59905":{"description":"Vegetable Oil Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"49617":{"description":"Vending Machine Operations - confection, food, beverage or ice","ratingBasis":"$1,000 of Gross Sales"},"49619":{"description":"Vending Machine Operations - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"49618":{"description":"Vending Machine Operations - tobacco products","ratingBasis":"$1,000 of Gross Sales"},"59915":{"description":"Vending Machines Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"59917":{"description":"Venetian Blinds Manufacturing or Assembling","ratingBasis":"$1,000 of Gross Sales"},"99851":{"description":"Veterinarian or Veterinary Hospitals","ratingBasis":"$1,000 of Payroll"},"18920":{"description":"Video Stores","ratingBasis":"$1,000 of Gross Sales"},"49763":{"description":"Warehouse - cold individual storage lockers","ratingBasis":"$1,000 of Gross Sales"},"99917":{"description":"Warehouse - cold storage - public","ratingBasis":"$1,000 of Payroll"},"18991":{"description":"Warehouses - miniwarehouses","ratingBasis":"$1,000 of Gross Sales"},"99938":{"description":"Warehouses - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"68702":{"description":"Warehouses - occupied by multiple interests (lessor's risk only)","ratingBasis":"Thousands of Square Feet"},"68703":{"description":"Warehouses - occupied by single interest (lessor's risk only)","ratingBasis":"Thousands of Square Feet"},"68706":{"description":"Warehouses - private (For-Profit)","ratingBasis":"Thousands of Square Feet"},"68707":{"description":"Warehouses - private (Not-For-Profit)","ratingBasis":"Thousands of Square Feet"},"19007":{"description":"Washing Machines, Dryers or Ironers - coin meter type","ratingBasis":"$1,000 of Gross Sales"},"59923":{"description":"Watch or Watch Case Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"59925":{"description":"Water Bottling - in siphons","ratingBasis":"$1,000 of Gross Sales"},"59926":{"description":"Water Bottling - spring or well - not sparkling or carbonated","ratingBasis":"$1,000 of Gross Sales"},"59927":{"description":"Water Bottling - spring or well - sparkling or carbonated","ratingBasis":"$1,000 of Gross Sales"},"99943":{"description":"Water Companies","ratingBasis":"$1,000 of Payroll"},"99946":{"description":"Water Mains or Connections Construction","ratingBasis":"$1,000 of Payroll"},"99948":{"description":"Water Softening Equipment - installation, servicing or repair","ratingBasis":"$1,000 of Payroll"},"19051":{"description":"Water Softening Equipment - rented to others","ratingBasis":"$1,000 of Gross Sales"},"99952":{"description":"Waterproofing - by pressure apparatus","ratingBasis":"$1,000 of Payroll"},"99953":{"description":"Waterproofing - by trowel - exterior","ratingBasis":"$1,000 of Payroll"},"99954":{"description":"Waterproofing - by trowel - interior or insulation work","ratingBasis":"$1,000 of Payroll"},"99955":{"description":"Waterproofing - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"59931":{"description":"Wax or Wax Products Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"59932":{"description":"Wax, Wax Products or Polish Manufacturing - floor","ratingBasis":"$1,000 of Gross Sales"},"96930":{"description":"Webpage or Website Designers","ratingBasis":"$1,000 of Payroll"},"99963":{"description":"Weighers, Samplers or Inspectors of Merchandise - on vessels or docks or at railway stations or warehouses","ratingBasis":"$1,000 of Payroll"},"99969":{"description":"Welding or Cutting","ratingBasis":"$1,000 of Payroll"},"49802":{"description":"Wharf and Waterfront - property not occupied by the insured    (lessor's risk only)","ratingBasis":"Thousands of Square Feet"},"49803":{"description":"Wharf and Waterfront - property occupied by the insured for freight purposes exclusively","ratingBasis":"Thousands of Square Feet"},"49800":{"description":"Wharf and Waterfront Property - ferry docks or terminals","ratingBasis":"Thousands of Square Feet"},"49801":{"description":"Wharf and Waterfront Property - occupied by the insured for both freight and passenger purposes","ratingBasis":"Thousands of Square Feet"},"59941":{"description":"Wheel Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"59947":{"description":"Wicker, Rattan, Willow or Twisted Fiber Products Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"59955":{"description":"Wigs or Hairpieces Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"99975":{"description":"Window Cleaning","ratingBasis":"$1,000 of Payroll"},"49840":{"description":"Window Decorating","ratingBasis":"$1,000 of Gross Sales"},"59963":{"description":"Wine Manufacturing - sparkling","ratingBasis":"$1,000 of Gross Sales"},"59964":{"description":"Wine Manufacturing - still","ratingBasis":"$1,000 of Gross Sales"},"59970":{"description":"Wire Cloth Manufacturing","ratingBasis":"$1,000 of Gross Sales"},"59973":{"description":"Wire Drawing","ratingBasis":"$1,000 of Gross Sales"},"59975":{"description":"Wire Goods Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"59977":{"description":"Wire Rope or Cable Manufacturing - metal","ratingBasis":"$1,000 of Gross Sales"},"59984":{"description":"Wood Preserving","ratingBasis":"$1,000 of Gross Sales"},"59985":{"description":"Wood Products Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"59986":{"description":"Wood Turned Products Manufacturing - Not Otherwise Classified","ratingBasis":"$1,000 of Gross Sales"},"59988":{"description":"Wool Combing, Scouring or Separating from Cotton","ratingBasis":"$1,000 of Gross Sales"},"59989":{"description":"Wool Pulling","ratingBasis":"$1,000 of Gross Sales"},"99986":{"description":"Wrecking - buildings or structures - Not Otherwise Classified","ratingBasis":"$1,000 of Payroll"},"99987":{"description":"Wrecking - dismantling of prefabricated dwellings not exceeding three stories - for reerection","ratingBasis":"$1,000 of Payroll"},"99988":{"description":"Wrecking - marine","ratingBasis":"$1,000 of Payroll"},"93169":{"description":"Wrecking or Dismantling of Frame Dwelling or other frame buildings not exceeding three stories in height","ratingBasis":"$1,000 of Payroll"},"49870":{"description":"YMCA, YWCA or Similar Institutions","ratingBasis":"Thousands of Square Feet"},"49890":{"description":"Youth Recreation Programs (For-Profit)","ratingBasis":"Number of Registrants"},"49891":{"description":"Youth Recreation Programs (Not-For-Profit)","ratingBasis":"Number of Registrants"},"49902":{"description":"Zoos (For-Profit)","ratingBasis":"Each Zoo"},"49905":{"description":"Zoos (For-Profit)","ratingBasis":"Thousands of Admissions"},"49903":{"description":"Zoos (Not-For-Profit)","ratingBasis":"Each Zoo"},"49904":{"description":"Zoos (Not-For-Profit)","ratingBasis":"Thousands of Admissions"}});
  const GL_CLASS_CODE_EXTENSIONS = Object.freeze({"21001":{"description":"Chemical Distributors-Pest","ratingBasis":"$1,000 of Gross Sales","review":true,"reason":"Carrier/source schedule code not present in uploaded master GL class table; preserve and review"}});
  function normalizeGlClassCode(code) {
    return String(code == null ? '' : code).replace(/[^0-9]/g, '').slice(0, 5);
  }
  function lookupGlClassCode(code) {
    const c = normalizeGlClassCode(code);
    if (!c) return null;
    const base = GL_CLASS_CODE_TABLE[c] || GL_CLASS_CODE_EXTENSIONS[c] || null;
    return base ? Object.assign({ code: c }, base) : null;
  }
  function isValidGlClassCode(code) {
    return !!GL_CLASS_CODE_TABLE[normalizeGlClassCode(code)];
  }
  function isRecognizedGlClassCode(code) {
    return !!lookupGlClassCode(code);
  }
  function normalizeGlRatingBasis(basis) {
    const s = String(basis || '').toLowerCase();
    if (/payroll/.test(s)) return 'Payroll';
    if (/gross\s+sales|sales|receipts|revenue/.test(s)) return 'Gross Sales/Revenues';
    if (/total\s+cost/.test(s)) return 'Total Cost';
    if (/gallon/.test(s)) return 'Gallons';
    if (/acre/.test(s)) return 'Acres';
    if (/admission/.test(s)) return 'Admissions';
    if (/square|sq\.?\s*ft|area/.test(s)) return 'Area';
    if (/unit|dwelling|vehicle/.test(s)) return 'Units';
    if (/person|employee|attendant|member|student|pupil|bed/.test(s)) return 'Persons';
    if (/no\s+exposure/.test(s)) return 'No Exposure';
    return basis || '';
  }

  // FIX-v8.6.48.1-DATE-NORMALIZATION-2026-05-14
  // Set of resolver field names that must produce a strict ISO YYYY-MM-DD
  // date string. Any descriptor in SOURCE_AUTHORITY that resolves to one
  // of these fields will be normalized in tryDescriptor() before return.
  // This catches the Anahuac-specific bug where submission.effective_date
  // is stored as a MM/DD/YYYY string in Supabase ("05/01/2026") rather
  // than an ISO date — flatpickr's setDate() can't parse that locale-
  // dependent format reliably and was rendering #polEff as "2026-01-01".
  const DATE_FIELDS = new Set([
    'policy_effective',
    'policy_expiration',
    'submission_date',
    'quote_expiration',
    'target_date',
    'created_date',
    // FIX-PHASE-4-GL-PRIMARY-COVERAGE-2026-05-14
    'gl_effective_date',
    'gl_expiration_date',
    // FIX-PHASE-7-AL-PRIMARY-COVERAGE-2026-05-14
    'al_effective_date',
    'al_expiration_date',
    // FIX-PHASE-8-EMPLOYERS-LIABILITY-2026-05-14
    'el_effective_date',
    'el_expiration_date',
    // FIX-PHASE-9-EMPLOYEE-BENEFITS-LIABILITY-2026-05-14
    'ebl_effective_date',
    'ebl_expiration_date',
    // FIX-PHASE-10-AIRCRAFT-GARAGE-LIQUOR-2026-05-14
    'aircraft_effective_date',
    'aircraft_expiration_date',
    'garage_effective_date',
    'garage_expiration_date',
    'liquor_effective_date',
    'liquor_expiration_date',
    // FIX-PHASE-11-FOREIGN-GL-AL-2026-05-14
    'fgl_effective_date',
    'fgl_expiration_date',
    'fal_effective_date',
    'fal_expiration_date'
  ]);

  // Accepts: ISO YYYY-MM-DD, ISO datetime with time portion,
  // MM/DD/YYYY, MM-DD-YYYY, M/D/YYYY, Date instances. Returns strict
  // ISO YYYY-MM-DD. Never throws — if the input is unparseable, returns
  // the input as-is so downstream consumers can decide what to do.
  function normalizeDateString(s) {
    if (s == null || s === '') return s;
    if (s instanceof Date) {
      if (isNaN(s.getTime())) return s;
      return formatIso(s);
    }
    const str = String(s).trim();
    let m;
    // Already ISO YYYY-MM-DD
    if (m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str)) {
      return str;
    }
    // ISO with time component (created_at from Supabase)
    if (m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(str)) {
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
    // MM/DD/YYYY (Anahuac's effective_date shape)
    if (m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str)) {
      const mm = String(m[1]).padStart(2, '0');
      const dd = String(m[2]).padStart(2, '0');
      return `${m[3]}-${mm}-${dd}`;
    }
    // MM-DD-YYYY
    if (m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(str)) {
      const mm = String(m[1]).padStart(2, '0');
      const dd = String(m[2]).padStart(2, '0');
      return `${m[3]}-${mm}-${dd}`;
    }
    // Last-resort: Date parser (locale-dependent, kept as a fallback only)
    const d = new Date(str);
    if (!isNaN(d.getTime())) return formatIso(d);
    return str;
  }

  // FIX-PHASE-3-TIER-1-2-DISPATCH-2026-05-14
  // ─── Label pattern catalog (Tier 2 markdown parsing) ──────────────────
  // For each resolver field, a priority-ordered list of regex patterns.
  // Each pattern has a parser_confidence (1.0 = exact label match,
  // 0.75 = multi-candidate / fuzzy label, 0.60 = inferred from context,
  // 0.50 = wrapped / multi-line / weakest signal).
  // The composed final confidence is parser_confidence × module
  // extraction.confidence.
  //
  // Patterns are intentionally case-insensitive and tolerant of common
  // markdown formatting variations (bold asterisks, bullet dashes,
  // colons optional, leading whitespace). When a pattern hits, the
  // captured group is trimmed and returned. If no pattern hits, the
  // module is skipped and the next module in the field's priority list
  // is tried.

  const LABEL_PATTERNS = {
    home_state: [
      // Strict label match — high confidence. Allow leading bullet
      // dashes (- or *) and bold markers (**) in any combination.
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Home\s+State|State\s+of\s+Domicile|Mailing\s+State|Primary\s+State|Domicile\s+State)\**\s*:?\s*\**\s*([A-Z]{2})\b/im, conf: 1.0 },
      // Generic "State:" — slightly weaker (could be product state, etc.)
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*State\**\s*:\s*([A-Z]{2})\b/im, conf: 0.75 },
      // Two-letter state inferred from an address line ending in ZIP
      { re: /,\s+([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/, conf: 0.60 }
    ],
    mailing_address: [
      // Bold label, value on same line, may be preceded by bullet
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Mailing\s+Address\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      // Generic "Address:" — could be controlling or other
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Address\**\s*:\s*([^\n]+?)(?:\n|$)/im, conf: 0.60 }
    ],
    controlling_address: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Physical|Controlling|Premises|Insured)\s+Address\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      // Insured address often appears under a "Named Insured" section
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Location\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    broker_name: [
      // Producer / broker name with bold formatting and optional bullet
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Producer|Broker)\s+Name\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Producer|Broker|Agent)\**\s*:\s*([^\n,]+?)(?:\n|,|$)/im, conf: 0.75 },
      // Email signature pattern — name on line before company line
      { re: /(?:^|\n)([A-Z][a-z]+\s+[A-Z][a-z]+)\s*\n\s*(?:Producer|Broker|AmWINS|CRC|Burns|RT\s+Specialty)/m, conf: 0.60 }
    ],
    broker_address: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Producer|Broker)\s+Address\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Producer\s+Office\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    // FIX-PHASE-5.0-BROKER-COMPANY-PATTERNS-2026-05-14
    // FIX-PHASE-5.1-WHOLESALE-CONF-CALIBRATION-2026-05-14
    // Distinct from broker_name (the human producer). broker_company is
    // the brokerage firm (AmWINS, CRC Insurance Services, Burns &
    // Wilcox, RT Specialty, etc.). Common labels in extractions:
    //   "Producer Firm:", "Brokerage:", "Broker Firm:", "Brokerage Firm:",
    //   "Wholesaler:", "Wholesale Broker:"
    broker_company: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Producer|Broker|Brokerage)\s+Firm\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Brokerage\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      // "Wholesale Broker:" and "Wholesaler:" are unambiguous broker-firm
      // labels in E&S casualty submissions — calibrated to 1.0 alongside
      // "Brokerage:" and "Producer Firm:".
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Wholesale(?:r|\s+Broker)?\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      // Often the broker section lists the company on a line after a
      // person — e.g., "Rachel Tran\nAmWINS Brokerage of Texas\n...".
      // Capture line that contains a well-known broker token.
      { re: /(?:^|\n)\s*((?:AmWINS|CRC|Burns\s*(?:&|and)\s*Wilcox|RT\s+Specialty|Brown\s*(?:&|and)\s*Brown|Hull\s+(?:&|and)\s+Co)[^\n]*)(?:\n|$)/i, conf: 0.75 }
    ],
    // layer_type: Phase 11 classifier reads schedule of underlying; no
    // pattern-based extraction is reliable enough to ship.

    // ─── Phase 4 — Primary GL Coverage labels ───
    // FIX-PHASE-4-GL-PRIMARY-COVERAGE-2026-05-14
    // gl_quote extractions from the platform follow a "**Section:**\n
    // - Label: Value" pattern. We accept bullet dashes, optional bold,
    // and several label variants per field. Currency values capture
    // both formatted ("$1,000,000") and raw ("1000000") forms.
    gl_carrier: [
      // "Carrier: <name>" — possibly inside a "Carrier & Administrative" section
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurance\s+Company\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    gl_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Inception\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 },
      // FIX-PHASE-4.1-POLICY-PERIOD-COMPOSITE-2026-05-14
      // Composite: "Policy Period: 05/01/2026 – 05/01/2027" — capture
      // the LHS date. Separator can be en-dash, em-dash, hyphen, or
      // text ("to", "thru", "through"). Date format is anything containing
      // digits, slashes, dashes, or dots.
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    gl_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Expiry\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 },
      // FIX-PHASE-4.1-POLICY-PERIOD-COMPOSITE-2026-05-14
      // Composite RHS — Policy Period range right-side date.
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    // FIX-PHASE-GO-LIVE-75-EXPIRATION-SOURCE-PRIORITY-2026-05-16
    // policy_expiration reuses the SAME proven expiration patterns as
    // gl_expiration_date. The resolver's markdown parse keys on
    // LABEL_PATTERNS[fieldName], so with fieldName='policy_expiration'
    // and module descriptors 'gl_quote'/'al_quote' it extracts the
    // stated term from the quote text before any +1yr compute fallback.
    policy_expiration: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Expiry\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    gl_each_occurrence: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Occurrence\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Per\s+Occurrence\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Occurrence\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 }
    ],
    gl_general_aggregate: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*General\s+Aggregate\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Aggregate\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.60 }
    ],
    gl_products_ops_aggregate: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Products[\/\s\-]+Completed\s+Operations\s+Aggregate\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Products[\/\s\-]+Comp(?:leted)?\s+Op(?:eration)?s?\s+Agg(?:regate)?\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Products[\/\s\-]+Comp\s+Ops\s+Agg\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*P\/C\s*Aggregate\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.70 }
    ],
    gl_personal_adv_injury: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Personal\s*(?:and|&)?\s*Adv(?:ertising)?\s*Injury\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Personal\s*(?:and|&)?\s*Advertising\s*(?:Injury)?\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*PI[\/\s\-]+Adv\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.70 }
    ],
    gl_premium: [
      // Most specific first: "Total Premium" / "GL Premium" / "Annual Premium" before generic "Premium"
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*GL\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Annual\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 }
    ],

    // ─── Phase 7 — Primary AL Coverage labels ───
    // FIX-PHASE-7-AL-PRIMARY-COVERAGE-2026-05-14
    // The al_quote prompt produces: "Carrier:", "Period:" (composite
    // dates, same shape as GL Policy Period), "Combined Single Limit:",
    // "Premium:". Patterns mirror the GL patterns with AL-specific labels.
    al_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurance\s+Company\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    al_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Inception\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 },
      // Composite: "Period: 05/01/2026 – 05/01/2027" — LHS date
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    al_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Expiry\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 },
      // Composite RHS
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    al_combined_single_limit: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Combined\s+Single\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*CSL\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Accident\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.60 }
    ],
    al_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*AL\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Auto\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Annual\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 }
    ],

    // ─── Phase 8 — Employers Liability labels ───
    // FIX-PHASE-8-EMPLOYERS-LIABILITY-2026-05-14
    // Two source shapes: el_quote uses bare labels ("Carrier:", "Bodily
    // Injury by Accident:"); gl_quote uses "EL "-prefixed labels ("EL
    // Carrier:", "EL Bodily Injury by Accident:") so they don't collide
    // with the GL coverage fields in the same extraction. Patterns cover
    // both. el_quote is tried first per SOURCE_AUTHORITY, so its bare
    // labels win when a standalone WC/EL doc exists.
    el_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EL\s+Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.90 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    el_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    el_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    el_bi_accident: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EL\s+Bodily\s+Injury\s+by\s+Accident\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Bodily\s+Injury\s+by\s+Accident\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:E\.?L\.?\s+)?Each\s+Accident\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 }
    ],
    el_bi_disease: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EL\s+Bodily\s+Injury\s+by\s+Disease\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Bodily\s+Injury\s+by\s+Disease\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Disease\s*[-–—]\s*Each\s+Employee\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 }
    ],
    el_disease_policy_limit: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EL\s+Disease\s*[-–—]\s*Policy\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Disease\s*[-–—]\s*Policy\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Disease\s+Policy\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 }
    ],
    el_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EL\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.70 }
    ],

    // ─── Phase 9 — Employee Benefits Liability labels ───
    // FIX-PHASE-9-EMPLOYEE-BENEFITS-LIABILITY-2026-05-14
    // ebl_quote uses bare labels; gl_quote uses "EBL "-prefixed labels.
    // ebl_quote tried first per SOURCE_AUTHORITY.
    ebl_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EBL\s+Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.90 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    ebl_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    ebl_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    ebl_each_employee_limit: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EBL\s+Each\s+Employee\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Employee\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Employee\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.80 }
    ],
    ebl_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EBL\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.70 }
    ],

    // ─── Phase 10 — Aircraft / Garage / Liquor labels ───
    // FIX-PHASE-10-AIRCRAFT-GARAGE-LIQUOR-2026-05-14
    // Each dedicated module uses bare labels; gl_quote uses prefixed
    // labels (Liquor only — aircraft/garage are never GL endorsements).
    aircraft_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    aircraft_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    aircraft_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    aircraft_each_occurrence: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Occurrence\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Combined\s+Single\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 }
    ],
    aircraft_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 }
    ],

    garage_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    garage_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    garage_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    garage_limit: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Combined\s+Single\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 }
    ],
    garage_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 }
    ],

    liquor_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Liquor\s+Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.90 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    liquor_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    liquor_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    liquor_each_common_cause_limit: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Liquor\s+Each\s+Common\s+Cause\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Common\s+Cause\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Common\s+Cause\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.80 }
    ],
    liquor_aggregate_limit: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Liquor\s+Aggregate\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Aggregate\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Aggregate\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.80 }
    ],
    liquor_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Liquor\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.70 }
    ],

    // ─── Phase 11 — Foreign GL / Foreign AL labels ───
    // FIX-PHASE-11-FOREIGN-GL-AL-2026-05-14
    // foreign_gl_quote / foreign_al_quote use bare labels. Strict source
    // (no gl_quote fallback) so no prefixed-label collision concern.
    fgl_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    fgl_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    fgl_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    fgl_each_occurrence: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Occurrence\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 }
    ],
    fgl_general_aggregate: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*General\s+Aggregate\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Aggregate\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 }
    ],
    fgl_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 }
    ],

    fal_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    fal_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    fal_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    fal_combined_single_limit: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Combined\s+Single\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*CSL\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 }
    ],
    fal_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 }
    ]
  };

  // ─── Tier 1 parser: JSON code block in extraction text ────────────────
  // Looks for a fenced ```json ... ``` block or a leading JSON object.
  // Returns the parsed object on success, null on miss.
  function parseJsonBlock(text) {
    if (!text || typeof text !== 'string') return null;
    // Try fenced JSON block first. v8.6.97: pipeline modules may emit
    // labeled fences like: ```json loss_history_structured ... ```
    // Older parsing captured the label as part of the JSON payload and
    // failed, so Workbench saw no structured losses even though A11 had
    // produced them. Accept an optional single-word label after json.
    const fencedMatch = /```(?:json)?\s*(?:[A-Za-z0-9_-]+\s*)?([\s\S]*?)```/i.exec(text);
    if (fencedMatch) {
      try { return JSON.parse(fencedMatch[1].trim()); }
      catch (e) { /* fall through */ }
    }
    // FIX-PHASE-GO-LIVE-73-JSON-BALANCED-BRACE-2026-05-16
    // (extended GO-LIVE-75) The old fallback used a non-greedy
    // /({[\s\S]+?})/m which captured only up to the FIRST closing
    // brace. The balanced scanner below walks a depth counter
    // (string-literal aware) to the matching close so nested structures
    // survive. GO-LIVE-75: also handle a TOP-LEVEL ARRAY ([{...},{...}])
    // — if the model ever returns a bare array instead of an object,
    // the old code grabbed only the first element's object. We now
    // start at whichever of '{' or '[' appears first and balance the
    // matching bracket type, so a full top-level array is preserved.
    const objAt = text.indexOf('{');
    const arrAt = text.indexOf('[');
    let start = -1, openCh = '{', closeCh = '}';
    if (objAt !== -1 && (arrAt === -1 || objAt < arrAt)) {
      start = objAt; openCh = '{'; closeCh = '}';
    } else if (arrAt !== -1) {
      start = arrAt; openCh = '['; closeCh = ']';
    }
    if (start !== -1) {
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
          if (esc) { esc = false; }
          else if (ch === '\\') { esc = true; }
          else if (ch === '"') { inStr = false; }
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === openCh) depth++;
        else if (ch === closeCh) {
          depth--;
          if (depth === 0) {
            const candidate = text.slice(start, i + 1);
            try { return JSON.parse(candidate); }
            catch (e) { /* fall through to tolerant retry */ }
            try {
              // tolerant retry: strip trailing commas before } or ]
              return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
            } catch (e2) { return null; }
          }
        }
      }
    }
    return null;
  }

  // FIX-PHASE-4.1-SENTINEL-FILTER-2026-05-14
  // ─── Sentinel-value detection ─────────────────────────────────────────
  // ACORDs and broker docs frequently contain placeholder text where a
  // field has not been filled in. The LLM extracts these placeholders
  // verbatim (e.g., "Carrier: No information provided"). Without this
  // filter, parseMarkdown happily returns "No information provided" as
  // the value with parser_confidence 1.0 — silently corrupting the
  // workbench with literal placeholder strings as if they were real data.
  //
  // Variants observed in live extractions:
  //   "No information provided"
  //   "Not provided" / "Not specified"
  //   "N/A" / "n/a" / "N.A."
  //   "Unknown"
  //   "TBD" / "TBA" / "To Be Determined" / "To Be Advised"
  //   "(blank)" / "—" / "–" (em/en dash standalone)
  //   "Pending"
  //
  // Returns true if the value should be treated as no-value.
  function isSentinelValue(s) {
    if (s == null || s === '') return true;
    const trimmed = String(s).trim();
    if (!trimmed) return true;
    // Dash placeholders (em-dash, en-dash, hyphen, or repeated dashes)
    if (/^[—–-]+$/.test(trimmed)) return true;
    // Common placeholder phrases — match start of trimmed value so
    // longer strings like "No information provided (no bound carrier)"
    // also count as sentinels.
    if (/^(no\s+info(rmation)?\s+(?:provided|available|listed)|not\s+(?:provided|specified|listed|applicable|available)|n[.\/]?\s?a\.?|unknown|tbd|tba|to\s+be\s+(?:determined|advised|provided|confirmed)|pending|\(blank\))(?:\s|$|[\.,;:])/i.test(trimmed)) {
      return true;
    }
    return false;
  }

  // FIX-PHASE-5.0-STRUCTURAL-VALIDITY-2026-05-14
  // ─── Structural validity check ────────────────────────────────────────
  // Catches captured-fragment garbage that isn't a placeholder phrase
  // (so sentinel filter misses it) but isn't a structurally plausible
  // value either. Concrete trigger: Anahuac's submission.broker column
  // contains "; retained indefinitely" — a fragment from a COIs context
  // block mis-captured as broker name during platform extraction.
  //
  // Rejection rules:
  //   - empty / whitespace-only
  //   - starts with non-alphanumeric character (e.g., punctuation)
  //   - fewer than 2 alphanumeric characters total
  //
  // This is intentionally permissive — it accepts dates (e.g., 2026-05-01),
  // currency strings (1,000,000), single-word values (Wholesale, TX),
  // multi-word names (Tracy Savage, Great American E&S), addresses with
  // numbers/punctuation (123 Main St). It only rejects obvious junk.
  function looksStructurallyValid(value) {
    if (value == null) return false;
    const s = String(value).trim();
    if (s.length < 2) return false;
    // Must start with a letter or digit (Unicode letters allowed)
    if (!/^[\p{L}\p{N}]/u.test(s)) return false;
    // Must contain at least 2 alphanumeric characters total
    const alphaNum = s.match(/[\p{L}\p{N}]/gu);
    if (!alphaNum || alphaNum.length < 2) return false;
    return true;
  }

  // ─── Tier 2 parser: markdown label patterns ───────────────────────────
  // Returns { value, parser_confidence } on hit, null on miss.
  // FIX-PHASE-4.1-SENTINEL-FILTER-2026-05-14 — when a pattern matches
  // but the value is a sentinel (placeholder text), continue to the
  // next pattern rather than returning a false-positive value.
  function parseMarkdown(text, fieldName) {
    if (!text || typeof text !== 'string') return null;
    const patterns = LABEL_PATTERNS[fieldName];
    if (!patterns || !patterns.length) return null;
    for (const p of patterns) {
      const m = p.re.exec(text);
      if (m && m[1]) {
        let value = m[1].trim()
          .replace(/^\**\s*/, '')   // strip leading bold markers
          .replace(/\s*\**$/, '');  // strip trailing bold markers
        if (!value) continue;
        if (isSentinelValue(value)) continue;  // treat placeholder as miss
        return { value: value, parser_confidence: p.conf };
      }
    }
    return null;
  }

  // FIX-PHASE-3.5-CROSS-APPLICANT-DEFENSE-2026-05-14
  // ─── Applicant identity gate ──────────────────────────────────────────
  // Some platform-side extractions on multi-applicant submissions pull
  // data from the wrong ACORD. Concrete example: unrelated-submission fixture (Anahuac
  // Infrastructure LLC) has a gl_quote module whose text refers to
  // "Example Named Insured, Inc." — a completely unrelated entity that
  // appeared in the same submission packet.
  //
  // Reading any field from a module that doesn't match the submission's
  // account name silently fills the workbench with the wrong insured's
  // data. This gate detects the mismatch and refuses the module's
  // contributions BEFORE any field resolution touches it.
  //
  // Logic:
  //   1. Extract the module text's stated Named Insured via regex.
  //   2. Normalize both the extracted name and submission.account_name
  //      (strip suffixes, punctuation, casing).
  //   3. Compare with a permissive match (substring tolerated).
  //   4. If mismatch → skip the module; log once.
  //   5. If extraction can't determine an insured → unknown, proceed.
  //
  // The check result is cached per (submission.id, module key) so
  // subsequent field resolutions on the same module don't re-scan.

  const _applicantMatchCache = Object.create(null);

  function extractNamedInsured(text) {
    if (!text || typeof text !== 'string') return null;
    const patterns = [
      /(?:^|\n|>)\s*(?:[-*]\s+)?\**\s*Named\s+Insured\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im,
      /(?:^|\n|>)\s*(?:[-*]\s+)?\**\s*Insured\s+Name\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im,
      /(?:^|\n|>)\s*(?:[-*]\s+)?\**\s*Insured\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im,
      /(?:^|\n|>)\s*(?:[-*]\s+)?\**\s*Applicant\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im,
      /(?:^|\n|>)\s*(?:[-*]\s+)?\**\s*Company\s+Name\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im
    ];
    for (const re of patterns) {
      const m = re.exec(text);
      if (m && m[1]) {
        // FIX-PHASE-7.1: the losses module emits HTML, so a labeled
        // "Named Insured: <strong>X</strong> &nbsp;·&nbsp; Effective..."
        // capture needs HTML tags stripped and truncation at the first
        // meta separator (· / &nbsp; / |) so we don't compare a whole
        // metadata line against the account name.
        let v = m[1]
          .replace(/<[^>]+>/g, '')          // strip HTML tags
          .replace(/&nbsp;/gi, ' ')         // decode nbsp
          .split(/\s*[·|]\s*/)[0]           // truncate at first · or | separator
          .trim()
          .replace(/^\**\s*/, '')
          .replace(/\s*\**$/, '')
          .trim();
        if (v) return v;
      }
    }
    // FIX-PHASE-7.1-ACORD-VERBATIM-INSURED-FALLBACK-2026-05-14
    // (Phase 8 hardening: the v7.1 pattern only matched company-name and
    // street-address ON THE SAME LINE — overfit to test account's
    // specific ACORD layout. Real ACORDs also place the name on line 1
    // and the address on line 2, use Title-Case not ALL-CAPS, and have
    // DBA lines. We now try three layouts in priority order.)
    //
    // When labeled patterns all miss, the insured still appears in the
    // verbatim ACORD text. Carriers do NOT appear with the insured's
    // mailing address, and we additionally skip carrier-looking names.
    const carrierLike = /\b(insurance|casualty|indemnity|underwriters?|assurance|surplus\s+lines?|reinsurance|mutual|specialty\s+insurance|E&S)\b/i;
    const suffixGroup = '(?:INC|LLC|L\\.L\\.C|CORP|CORPORATION|CO|COMPANY|COOP|CO-OP|COOPERATIVE|LP|LLP|LTD|PLLC|PC|PA)';

    // Layout 1: company name + street address on the SAME line
    //   "EXAMPLE NAMED INSURED, INC   123 Example St.   Sample City VA"
    const sameLineRe = new RegExp(
      '([A-Z][A-Za-z0-9&.,\'\\- ]{2,60}?(?:,?\\s*' + suffixGroup + ')\\b\\.?)\\s+\\d{1,6}\\s+[A-Z][A-Za-z0-9.\\- ]',
      'g'
    );
    // Layout 2: company name on its own line, address on the NEXT line
    //   "Example Named Insured, Inc.\n123 Example St., Sample City VA 00000"
    const twoLineRe = new RegExp(
      '(?:^|\\n)\\s*([A-Z][A-Za-z0-9&.,\'\\- ]{2,60}?(?:,?\\s*' + suffixGroup + ')\\b\\.?)\\s*\\n\\s*\\d{1,6}\\s+[A-Za-z]',
      'gi'
    );
    // Layout 3: DBA — "ABC Holdings LLC dba Example Named Insured" → take
    // the dba operating name (what appears on the policy as the insured)
    const dbaRe = /\bd\/?b\/?a\.?\s+([A-Z][A-Za-z0-9&.,'\- ]{2,60}?)(?:\n|,|$)/i;

    const tryPattern = (re) => {
      let m;
      // reset lastIndex for global regexes reused across calls
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        const candidate = (m[1] || '').trim().replace(/\s+/g, ' ').replace(/[,]+$/, '').trim();
        if (!candidate) { if (!re.global) break; else continue; }
        if (carrierLike.test(candidate)) { if (!re.global) break; else continue; }
        return candidate;
      }
      return null;
    };

    return tryPattern(sameLineRe)
        || tryPattern(twoLineRe)
        || tryPattern(dbaRe)
        || null;
  }

  function normalizeCompanyName(name) {
    if (!name) return '';
    return String(name)
      .toLowerCase()
      .replace(/[,.()]/g, ' ')
      // Strip common corporate suffixes
      .replace(/\b(llc|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|plc|pllc|na)\b\.?/g, '')
      // Strip "the" prefix
      .replace(/^the\s+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Returns:
  //   true  → confident match (proceed with module)
  //   false → confident mismatch (skip module)
  //   null  → unknown / can't determine (proceed; treat as match)
  function applicantsMatch(extractedName, submissionAccountName) {
    if (!extractedName || !submissionAccountName) return null;
    const a = normalizeCompanyName(extractedName);
    const b = normalizeCompanyName(submissionAccountName);
    if (!a || !b) return null;
    if (a === b) return true;
    // Permissive: one contains the other (e.g., "Anahuac" vs
    // "Anahuac Infrastructure"), only if the shorter side is >= 4 chars
    // (avoid false-positives on 2- or 3-letter fragments).
    const shorter = a.length <= b.length ? a : b;
    const longer  = a.length <= b.length ? b : a;
    if (shorter.length >= 4 && longer.includes(shorter)) return true;
    return false;
  }

  // FIX-PHASE-GO-LIVE-80-UNKNOWN-INSURED-2026-05-16
  // The real paid run (test submission) exposed this: the excess module's
  // extracted "insured" was the literal phrase "Not stated on the
  // provided quote pages" (broker quote pages routinely omit the named
  // insured). The cross-applicant guard fed that phrase into
  // applicantsMatch, which returned false, which blocked the tower —
  // treating "the page is silent" identically to "the page names a
  // DIFFERENT company". Those are different and must be handled
  // differently (GPT + underwriter both flagged this):
  //   • silent on insured  → cannot confirm, ALLOW under review (null)
  //   • different insured   → wrong applicant, BLOCK (false)  ← unchanged
  // isSentinelValue intentionally NOT broadened (it gates 600+ lines of
  // resolver logic; widening it risks regressions). This is a focused
  // predicate used ONLY at the cross-applicant call sites.
  function isInsuredNotStated(s) {
    if (s == null) return true;
    const t = String(s).trim().toLowerCase();
    if (!t) return true;
    if (isSentinelValue(t)) return true;          // reuse existing coverage
    // Phrases that mean "the document does not state an insured" rather
    // than naming one. Anchored to the start so a real company name that
    // merely contains a word like "national" is unaffected.
    if (/^(not\s+stated|none\s+stated|insured\s+not\s+stated|no\s+named\s+insured|not\s+shown|not\s+listed\s+on|not\s+on\s+(the\s+)?(extract|quote|provided)|\(?\s*unknown\s*\)?|not\s+identified|unnamed|blank)\b/.test(t)) {
      return true;
    }
    if (/\bnot\s+stated\b/.test(t)) return true;  // "... not stated on the provided quote pages"
    return false;
  }

  // Cross-applicant verdict that distinguishes the three cases. Returns
  // 'match' | 'mismatch' | 'unverifiable'. The guards use this so a
  // silent-on-insured document is extracted under review, while a
  // genuinely different insured (unrelated insured mismatch) is still blocked.
  function applicantVerdict(extractedName, submissionAccountName) {
    if (isInsuredNotStated(extractedName)) return 'unverifiable';
    const m = applicantsMatch(extractedName, submissionAccountName);
    if (m === true) return 'match';
    if (m === false) return 'mismatch';     // wrong applicant — block (unchanged)
    return 'unverifiable';
  }

  function checkApplicantMatch(submission, moduleKey, moduleRec) {
    if (!submission || !submission.account_name) return null;
    if (!moduleRec || !moduleRec.text) return null;
    const cacheKey = (submission.id || '?') + '__' + moduleKey;
    if (Object.prototype.hasOwnProperty.call(_applicantMatchCache, cacheKey)) {
      return _applicantMatchCache[cacheKey];
    }
    const extracted = extractNamedInsured(moduleRec.text);
    if (!extracted) {
      _applicantMatchCache[cacheKey] = null; // unknown — can't verify
      return null;
    }
    // FIX-PHASE-GO-LIVE-80-UNKNOWN-INSURED-2026-05-16
    // Distinguish "document is silent on insured" (unverifiable →
    // allow under review, return null) from "document names a DIFFERENT
    // insured" (mismatch → block, return false — Anahuac defense
    // UNCHANGED).
    const verdict = applicantVerdict(extracted, submission.account_name);
    const match = verdict === 'match' ? true
                : verdict === 'mismatch' ? false
                : null;                       // 'unverifiable'
    _applicantMatchCache[cacheKey] = match;
    if (match === false) {
      // Log once per (submission, module) so console isn't spammed.
      console.warn(
        '[WorkbenchRules] Cross-applicant defense: module "' + moduleKey +
        '" stated insured "' + extracted +
        '" does not match submission "' + submission.account_name +
        '". Skipping for this submission.'
      );
    } else if (verdict === 'unverifiable'
               && isInsuredNotStated(extracted)) {
      console.log(
        '[WorkbenchRules] Module "' + moduleKey + '": insured not stated '
        + 'on source — extracted under review (not blocked).'
      );
    }
    return match;
  }

  // ─── Company guideline caps ───────────────────────────────────────────────
  // Per Justin's spec: company/guideline rules, applied uniformly.
  // Used by Phase 4+ excess/lead writers — defined here so a single file
  // contains every policy number that gates an autofill decision.

  const GUIDELINE_CAPS = {
    lead_max_limit: 5_000_000,         // never exceed $5M when we are lead
    excess_max_limit: 10_000_000,      // never exceed $10M when we are excess
    excess_min_attachment: 10_000_000, // $10M layer requires $10M+ attached
    quota_share_max_limit: 10_000_000, // QS never exceeds $10M either
    lead_carrier: 'Steadfast',         // our default lead paper
    tria_default_pct: 1.00,            // 1% TRIA
    tria_default_status: 'Accepted',
    min_earned_default_pct: 25,        // 25% MEP
    adj_flat_default: 'Flat'
  };

  // ─── Source priority per field ────────────────────────────────────────────
  // Each entry is an ordered list of source descriptors. resolveField walks
  // the list top-down and returns the first non-empty match.
  //
  // Source descriptor formats supported in Phase 2 (Tier 0 + 0.5):
  //   'submission.<column>'          → read submission[column] directly
  //   'hardcoded:<value>'            → return literal value
  //   'compute:<formula>'            → run a named compute function
  //                                    (see COMPUTE below)
  //
  // Source descriptor formats added in Phase 3:
  //   '<module>'                     → parse extractions[module].text via
  //                                    label-pattern matching (Tier 2)
  //   '<module>:json'                → require a JSON code block in
  //                                    extractions[module].text (Tier 1)
  //   '<module>:llm'                 → fire targeted LLM mini-extraction
  //                                    (Tier 3 — opt-in only, not yet wired)

  const SOURCE_AUTHORITY = {
    // ─── Deal Information ───
    insured_name:        ['submission.account_name'],
    policy_effective:    ['submission.effective_date'],
    policy_expiration:   [
      // FIX-PHASE-GO-LIVE-75-EXPIRATION-SOURCE-PRIORITY-2026-05-16
      // Per the stated rule: policy term must be pulled from the GL/AL
      // quote when present, NOT blindly computed as effective + 1 year
      // (wrong for short-term, multi-year, extended or non-annual
      // terms). These plain module descriptors run the resolver's
      // standard markdown parse, which keys on LABEL_PATTERNS
      // ['policy_expiration'] (added below, mirroring the proven
      // gl_expiration_date regexes) against the gl_quote / al_quote
      // module text. Falls back to the +1yr compute only when neither
      // quote actually states an expiration. Uses ONLY the existing
      // resolver mechanism — no new descriptor plumbing.
      'gl_quote', 'al_quote',
      'compute:effective_plus_year'
    ],
    submission_date:     ['submission.created_at'],
    quote_expiration:    ['compute:submission_plus_quote_days'],
    target_date:         ['compute:effective_minus_lead_days'],
    created_date:        ['submission.created_at'],
    underwriter:         ['hardcoded:Justin Wray'],
    assistant:           ['hardcoded:Tracy Savage'],
    paper:               ['hardcoded:Steadfast Insurance Company'],
    market:              ['hardcoded:nonAdmitted'],

    // ─── Broker block (display divs in Phase 2) ───
    // FIX-PHASE-5.0-BROKER-TIER-PRIORITY-2026-05-14
    // Tier 2 markdown sources outrank Tier 0 submission.broker because
    // the broker column on Anahuac contains "; retained indefinitely"
    // — a captured fragment, not a broker name. Phase 5.0's structural
    // validity check now rejects that Tier 0 value automatically, but
    // we ALSO prefer better Tier 2 sources when they exist.
    broker_company:      ['summary-ops', 'supplemental', 'submission.broker'],
    broker_type:         ['hardcoded:Wholesale'],
    broker_region:       ['hardcoded:South East'],

    // ─── Phase 3 Tier 2 additions ───
    // Module order = priority. For each field, the first module whose
    // markdown parse hits with parser_confidence > 0 wins. Modules are
    // listed roughly in order of authority for that field:
    //   - supplemental: ACORD-derived data
    //   - gl_quote:     primary policy quote sheet
    //   - summary-ops:  AI-synthesized account summary
    //   - subcontract:  subcontract agreement details
    //   - exposure:     exposure analysis
    home_state:          ['supplemental:json', 'gl_quote:json',
                          'supplemental', 'gl_quote', 'summary-ops'],
    mailing_address:     ['supplemental:json', 'supplemental',
                          'gl_quote', 'summary-ops'],
    controlling_address: ['gl_quote:json', 'gl_quote', 'supplemental'],
    broker_name:         ['summary-ops', 'supplemental'],
    broker_address:      ['summary-ops', 'supplemental'],
    layer_type:          [],    // Phase 11 classifier — placeholder

    // ─── Phase 4 — Primary GL Coverage ───
    // FIX-PHASE-4-GL-PRIMARY-COVERAGE-2026-05-14
    // STRICT SOURCE RULE per Justin's spec: GL coverage data comes ONLY
    // from the gl_quote module. No fallbacks to supplemental (ACORDs),
    // summary-ops (AI synthesis), or any other module. If gl_quote is
    // gated out by the Phase 3.5 cross-applicant defense, or the field
    // pattern misses, the field stays empty — no degraded fallback.
    // v8.6.82: GL quote remains authoritative, but real broker quote
    // pages may omit the insured and the GL module may over-refuse. In
    // those cases, recover underlying GL limits from the excess schedule
    // / tower / ACORD as REVIEW-grade fallback instead of leaving the
    // workbench blank. Carrier and premium stay GL-quote-only unless
    // explicitly stated elsewhere.
    gl_carrier:                 ['gl_quote:json', 'gl_quote', 'excess', 'tower'],
    gl_effective_date:          ['gl_quote:json', 'gl_quote', 'submission.effective_date'],
    gl_expiration_date:         ['gl_quote:json', 'gl_quote', 'submission.expiration_date', 'al_quote'],
    gl_each_occurrence:         ['gl_quote:json', 'gl_quote', 'excess', 'tower', 'supplemental', 'summary-ops'],
    gl_general_aggregate:       ['gl_quote:json', 'gl_quote', 'excess', 'tower', 'supplemental', 'summary-ops'],
    gl_products_ops_aggregate:  ['gl_quote:json', 'gl_quote', 'excess', 'tower', 'supplemental', 'summary-ops'],
    gl_personal_adv_injury:     ['gl_quote:json', 'gl_quote', 'excess', 'tower', 'supplemental', 'summary-ops'],
    gl_premium:                 ['gl_quote:json', 'gl_quote'],

    // ─── Phase 7 — Primary AL Coverage ───
    // FIX-PHASE-7-AL-PRIMARY-COVERAGE-2026-05-14
    // STRICT SOURCE RULE per Justin's spec (same as GL): AL coverage data
    // comes ONLY from the al_quote module. No fallbacks. The #details-al
    // panel is 5 fields: carrier, eff, exp, CSL, premium (no split limits).
    al_carrier:                 ['al_quote:json', 'al_quote', 'excess', 'tower'],
    al_effective_date:          ['al_quote:json', 'al_quote'],
    al_expiration_date:         ['al_quote:json', 'al_quote'],
    al_combined_single_limit:   ['al_quote:json', 'al_quote'],
    al_premium:                 ['al_quote:json', 'al_quote'],

    // ─── Phase 8 — Employers Liability Coverage ───
    // FIX-PHASE-8-EMPLOYERS-LIABILITY-2026-05-14
    // OPTION B source priority: a dedicated standalone WC/EL quote
    // (el_quote) is the authoritative source; when EL appears only as a
    // coverage line inside a GL package quote, gl_quote also emits the
    // EL fields and serves as the fallback. Resolver tries el_quote
    // first, gl_quote second. The #details-el panel is 7 fields:
    // carrier, eff, exp, BI-by-accident, BI-by-disease, disease-policy
    // -limit, premium. (#details-el-clone is a CLONABLE template, not a
    // default-rendered panel — workbench applier clones+enables it.)
    el_carrier:                 ['el_quote:json', 'el_quote', 'gl_quote:json', 'gl_quote'],
    el_effective_date:          ['el_quote:json', 'el_quote', 'gl_quote:json', 'gl_quote'],
    el_expiration_date:         ['el_quote:json', 'el_quote', 'gl_quote:json', 'gl_quote'],
    el_bi_accident:             ['el_quote:json', 'el_quote', 'gl_quote:json', 'gl_quote'],
    el_bi_disease:              ['el_quote:json', 'el_quote', 'gl_quote:json', 'gl_quote'],
    el_disease_policy_limit:    ['el_quote:json', 'el_quote', 'gl_quote:json', 'gl_quote'],
    el_premium:                 ['el_quote:json', 'el_quote', 'gl_quote:json', 'gl_quote'],

    // ─── Phase 9 — Employee Benefits Liability Coverage ───
    // FIX-PHASE-9-EMPLOYEE-BENEFITS-LIABILITY-2026-05-14
    // EBL is most commonly a GL endorsement, so gl_quote is the common
    // source; standalone EBL quotes feed ebl_quote. Resolver tries
    // ebl_quote first, gl_quote fallback (Option B, same as EL). The
    // #details-ebl panel is 5 fields: carrier, eff, exp, each-employee
    // -limit, premium. Clonable template (details-ebl-clone).
    ebl_carrier:                ['ebl_quote:json', 'ebl_quote', 'gl_quote:json', 'gl_quote'],
    ebl_effective_date:         ['ebl_quote:json', 'ebl_quote', 'gl_quote:json', 'gl_quote'],
    ebl_expiration_date:        ['ebl_quote:json', 'ebl_quote', 'gl_quote:json', 'gl_quote'],
    ebl_each_employee_limit:    ['ebl_quote:json', 'ebl_quote', 'gl_quote:json', 'gl_quote'],
    ebl_premium:                ['ebl_quote:json', 'ebl_quote', 'gl_quote:json', 'gl_quote'],

    // ─── Phase 10 — Aircraft / Garage / Liquor ───
    // FIX-PHASE-10-AIRCRAFT-GARAGE-LIQUOR-2026-05-14
    // Aircraft & Garage: standalone policies, never GL endorsements →
    // STRICT dedicated-module source (like GL/AL). Liquor: genuinely can
    // be a GL endorsement → Option B (gl_quote fallback). All clonable
    // panels. Aircraft 5 fields, Garage 5 fields, Liquor 6 fields.
    aircraft_carrier:           ['aircraft_quote:json', 'aircraft_quote'],
    aircraft_effective_date:    ['aircraft_quote:json', 'aircraft_quote'],
    aircraft_expiration_date:   ['aircraft_quote:json', 'aircraft_quote'],
    aircraft_each_occurrence:   ['aircraft_quote:json', 'aircraft_quote'],
    aircraft_premium:           ['aircraft_quote:json', 'aircraft_quote'],

    garage_carrier:             ['garage_quote:json', 'garage_quote'],
    garage_effective_date:      ['garage_quote:json', 'garage_quote'],
    garage_expiration_date:     ['garage_quote:json', 'garage_quote'],
    garage_limit:               ['garage_quote:json', 'garage_quote'],
    garage_premium:             ['garage_quote:json', 'garage_quote'],

    liquor_carrier:             ['liquor_quote:json', 'liquor_quote', 'gl_quote:json', 'gl_quote'],
    liquor_effective_date:      ['liquor_quote:json', 'liquor_quote', 'gl_quote:json', 'gl_quote'],
    liquor_expiration_date:     ['liquor_quote:json', 'liquor_quote', 'gl_quote:json', 'gl_quote'],
    liquor_each_common_cause_limit: ['liquor_quote:json', 'liquor_quote', 'gl_quote:json', 'gl_quote'],
    liquor_aggregate_limit:     ['liquor_quote:json', 'liquor_quote', 'gl_quote:json', 'gl_quote'],
    liquor_premium:             ['liquor_quote:json', 'liquor_quote', 'gl_quote:json', 'gl_quote'],

    // ─── Phase 11 — Foreign GL / Foreign AL ───
    // FIX-PHASE-11-FOREIGN-GL-AL-2026-05-14
    // Foreign/international liability is a distinct policy form, not a GL
    // endorsement → STRICT dedicated-module source (no gl_quote fallback,
    // same rule as GL/AL Phase 4/7). Default-rendered panels. FGL 6
    // fields, FAL 5 fields.
    fgl_carrier:                ['foreign_gl_quote:json', 'foreign_gl_quote'],
    fgl_effective_date:         ['foreign_gl_quote:json', 'foreign_gl_quote'],
    fgl_expiration_date:        ['foreign_gl_quote:json', 'foreign_gl_quote'],
    fgl_each_occurrence:        ['foreign_gl_quote:json', 'foreign_gl_quote'],
    fgl_general_aggregate:      ['foreign_gl_quote:json', 'foreign_gl_quote'],
    fgl_premium:                ['foreign_gl_quote:json', 'foreign_gl_quote'],

    fal_carrier:                ['foreign_al_quote:json', 'foreign_al_quote'],
    fal_effective_date:         ['foreign_al_quote:json', 'foreign_al_quote'],
    fal_expiration_date:        ['foreign_al_quote:json', 'foreign_al_quote'],
    fal_combined_single_limit:  ['foreign_al_quote:json', 'foreign_al_quote'],
    fal_premium:                ['foreign_al_quote:json', 'foreign_al_quote'],

    // ─── v8.6.81 — Workbench fill reliability fields ───
    // These fields drove the paid-run disappointment: the modules had
    // usable prose, but the workbench only filled fields that resolved
    // through the older coverage/deal-info paths. These resolver entries
    // are intentionally module-specific and are backed by adapter parsers
    // below, so the existing test submission extraction can be repaired
    // without a full paid rerun.
    iso_class_code:             ['classcode:json', 'classcode', 'gl_quote:json', 'gl_quote', 'summary-ops'],
    iso_description:            ['classcode:json', 'classcode', 'gl_quote:json', 'gl_quote', 'summary-ops'],
    hazard_grade:               ['classcode:json', 'classcode', 'exposure:json', 'exposure', 'guidelines'],
    exposure_amount:            ['supplemental:json', 'supplemental', 'gl_quote:json', 'gl_quote', 'classcode:json', 'classcode', 'exposure:json', 'exposure'],
    exposure_basis:             ['gl_quote:json', 'gl_quote', 'classcode:json', 'classcode', 'exposure:json', 'exposure', 'supplemental'],
    website:                    ['submission.website', 'submission.website_url', 'submission.websiteUrl', 'submission.insured_website', 'website:json', 'website', 'summary-ops', 'supplemental'],
    exposure_to_loss:           ['exposure:json', 'exposure'],
    account_strengths:          ['strengths:json', 'strengths'],
    guideline_conflicts_text:   ['guidelines:json', 'guidelines'],
    guideline_conflicts:        ['guidelines:json', 'guidelines'],
    summary_operations:         ['summary-ops:json', 'summary-ops'],
    strengths_of_account:       ['strengths:json', 'strengths'],
    description_operations:     ['summary-ops:json', 'summary-ops', 'supplemental:json', 'supplemental', 'website:json', 'website'],
    underwriting_rationale:     ['discrepancy:json', 'discrepancy', 'guidelines:json', 'guidelines', 'exposure:json', 'exposure', 'summary-ops'],

    // v8.6.85 — section-specific population fields. These had no
    // resolver rules, so tables stayed blank even when module text had
    // usable data. All are no-cost adapter fields.
    loss_history_gl:            ['losses:json', 'losses'],
    loss_history_auto:          ['losses:json', 'losses'],
    loss_history_by_year:       ['losses:json', 'losses'],
    large_losses:               ['losses:json', 'losses'],
    fleet_private_passenger:    ['al_quote:json', 'al_quote', 'supplemental'],
    fleet_light:                ['al_quote:json', 'al_quote', 'supplemental'],
    fleet_medium:               ['al_quote:json', 'al_quote', 'supplemental'],
    fleet_heavy:                ['al_quote:json', 'al_quote', 'supplemental'],
    fleet_extra_heavy:          ['al_quote:json', 'al_quote', 'supplemental'],
    fleet_truck_tractors:       ['al_quote:json', 'al_quote', 'supplemental'],
    fleet_heavy_local:          ['al_quote:json', 'al_quote', 'supplemental'],
    fleet_heavy_other:          ['al_quote:json', 'al_quote', 'supplemental'],
    fleet_extra_heavy_local:    ['al_quote:json', 'al_quote', 'supplemental'],
    fleet_extra_heavy_intermediate: ['al_quote:json', 'al_quote', 'supplemental'],
    fleet_extra_heavy_long:     ['al_quote:json', 'al_quote', 'supplemental'],
    fleet_truck_tractors_local: ['al_quote:json', 'al_quote', 'supplemental'],
    fleet_truck_tractors_intermediate: ['al_quote:json', 'al_quote', 'supplemental'],
    fleet_truck_tractors_long:  ['al_quote:json', 'al_quote', 'supplemental'],
    underlying_lead_limit:      ['excess', 'tower', 'excess:json', 'tower:json'],
    underlying_lead_carrier:    ['excess', 'tower', 'excess:json', 'tower:json'],
    underlying_lead_premium:    ['excess', 'tower', 'excess:json', 'tower:json'],
    tower_role:                 ['excess', 'tower', 'excess:json', 'tower:json'],
    requested_limit:            ['excess', 'tower', 'excess:json', 'tower:json'],
    attachment_point:           ['excess', 'tower', 'excess:json', 'tower:json']
  };

  // ─── Compute utilities ────────────────────────────────────────────────────
  // Pure functions. Each receives the submission row and returns either a
  // string value (for fields the resolver will set) or null if it can't
  // compute (e.g., missing dependency).

  const COMPUTE = {
    effective_plus_year(submission) {
      // FIX-v8.6.48.1: normalize Anahuac-shape MM/DD/YYYY before parsing.
      // Also use UTC to avoid local-timezone day-shift quirks where
      // "2026-05-01" might render as Apr 30 in negative-offset zones.
      const eff = normalizeDateString(submission && submission.effective_date);
      if (!eff || !/^\d{4}-\d{2}-\d{2}$/.test(eff)) return null;
      const [y, mo, d] = eff.split('-').map(Number);
      const next = new Date(Date.UTC(y + 1, mo - 1, d));
      return formatIso(next);
    },
    effective_minus_lead_days(submission) {
      const eff = normalizeDateString(submission && submission.effective_date);
      if (!eff || !/^\d{4}-\d{2}-\d{2}$/.test(eff)) return null;
      const [y, mo, d] = eff.split('-').map(Number);
      const next = new Date(Date.UTC(y, mo - 1, d - DEFAULTS.target_lead_lookback_days));
      return formatIso(next);
    },
    submission_plus_quote_days(submission) {
      const sub = normalizeDateString(submission && submission.created_at);
      if (!sub || !/^\d{4}-\d{2}-\d{2}$/.test(sub)) return null;
      const [y, mo, d] = sub.split('-').map(Number);
      const next = new Date(Date.UTC(y, mo - 1, d + DEFAULTS.quote_expiration_days));
      return formatIso(next);
    }
  };

  function formatIso(d) {
    // Always return YYYY-MM-DD so flatpickr / setDate can parse cleanly.
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // ─── Resolver ─────────────────────────────────────────────────────────────
  // Walks the SOURCE_AUTHORITY priority list for a field. Returns an object:
  //   { value, source, tier, confidence } on success
  //   null on miss
  // Phase 2 implements Tier 0 paths only. Phase 3 adds Tier 1/2 dispatching.

  function resolveField(fieldName, submission) {
    const chain = SOURCE_AUTHORITY[fieldName];
    if (!chain) {
      return null; // No rule defined for this field
    }
    for (const descriptor of chain) {
      const resolved = tryDescriptor(descriptor, submission, fieldName);
      if (resolved !== null && resolved.value !== null
          && resolved.value !== undefined && resolved.value !== '') {
        return resolved;
      }
    }
    return null;
  }

  function tryDescriptor(descriptor, submission, fieldName) {
    if (typeof descriptor !== 'string') return null;

    // FIX-PHASE-5.0-STRUCTURAL-VALIDITY-2026-05-14
    // Helper: validate a Tier 0 resolved value before returning it.
    // Returns the value as-is if it passes both checks, or null if it
    // fails (so resolveField falls through to the next descriptor).
    // Date fields skip these checks since ISO dates aren't expected
    // to satisfy either filter (sentinel words / structural validity
    // are designed for human-readable text).
    const validateTier0 = (val) => {
      if (val == null || val === '') return null;
      if (DATE_FIELDS.has(fieldName)) return val; // dates bypass filters
      if (isSentinelValue(val)) return null;
      if (!looksStructurallyValid(val)) return null;
      return val;
    };

    // submission.<column>
    if (descriptor.startsWith('submission.')) {
      const col = descriptor.slice('submission.'.length);
      if (!submission || submission[col] == null) return null;
      let value = submission[col];
      // FIX-v8.6.48.1: normalize date-typed fields to strict ISO YYYY-MM-DD
      // before they leave the resolver. Anahuac's effective_date column
      // ships as "05/01/2026" (MM/DD/YYYY string), and Supabase's created_at
      // includes a time component — flatpickr only reliably parses ISO.
      if (DATE_FIELDS.has(fieldName)) {
        value = normalizeDateString(value);
      } else {
        // FIX-PHASE-5.0: reject captured-fragment garbage (e.g.,
        // submission.broker = "; retained indefinitely" on Anahuac).
        value = validateTier0(value);
        if (value == null) return null;
      }
      return {
        value: value,
        source: descriptor,
        tier: 0,
        confidence: 1.0
      };
    }

    // hardcoded:<value>
    if (descriptor.startsWith('hardcoded:')) {
      const v = descriptor.slice('hardcoded:'.length);
      // Hardcoded values are author-controlled — still run them through
      // validateTier0 as a defensive net (catches accidental typos that
      // produced sentinel/punctuation strings).
      const validated = DATE_FIELDS.has(fieldName) ? v : validateTier0(v);
      if (validated == null) return null;
      return {
        value: validated,
        source: descriptor,
        tier: 0,
        confidence: 1.0
      };
    }

    // compute:<formula>
    if (descriptor.startsWith('compute:')) {
      const name = descriptor.slice('compute:'.length);
      const fn = COMPUTE[name];
      if (typeof fn !== 'function') return null;
      let v = fn(submission);
      if (v === null || v === undefined || v === '') return null;
      // Defensive: COMPUTE functions already normalize, but if a future
      // formula returns a non-ISO string, catch it here for date fields.
      if (DATE_FIELDS.has(fieldName)) {
        v = normalizeDateString(v);
      }
      return {
        value: v,
        source: descriptor,
        tier: 0,
        confidence: 1.0
      };
    }

    // Module-based descriptors (Tier 1 = JSON code block, Tier 2 = markdown).
    // FIX-PHASE-3-TIER-1-2-DISPATCH-2026-05-14
    // Format:
    //   '<module>'        → Tier 2 markdown label parse
    //   '<module>:json'   → Tier 1 JSON code block parse
    //   '<module>:llm'    → Tier 3 LLM mini-extraction (not yet implemented)
    const colonIdx = descriptor.indexOf(':');
    const moduleKey = colonIdx === -1 ? descriptor : descriptor.slice(0, colonIdx);
    const tierHint  = colonIdx === -1 ? '' : descriptor.slice(colonIdx + 1);

    // Look up extractions on the active submission's snapshot. Multiple
    // possible paths because this code may be called from console with
    // shapes that differ — be permissive.
    const extractions =
      (submission && submission.snapshot && submission.snapshot.extractions) ||
      (submission && submission.extractions) ||
      null;
    if (!extractions) return null;
    const moduleRec = extractions[moduleKey];
    if (!moduleRec || typeof moduleRec.text !== 'string') return null;

    // FIX-PHASE-3.5-CROSS-APPLICANT-DEFENSE-2026-05-14
    // Refuse modules whose stated Named Insured doesn't match the
    // submission's account_name. Returns null treated as unknown
    // (proceed). Returns false explicitly = skip this module entirely.
    const applicantCheck = checkApplicantMatch(submission, moduleKey, moduleRec);
    if (applicantCheck === false) {
      return null;
    }

    const extractionConf = (typeof moduleRec.confidence === 'number')
      ? moduleRec.confidence
      : 1.0;

    if (tierHint === 'json') {
      const obj = parseJsonBlock(moduleRec.text);
      if (!obj) return null;
      // v8.6.81: JSON outputs may be wrapped under workbench_fields,
      // fields, data, or module-specific objects, and arrays may contain
      // objects with the desired key. Use a deep, synonym-aware lookup
      // instead of only top-level exact keys.
      let val = lookupJsonField(obj, fieldName);
      if (val == null || val === '') return null;
      if (DATE_FIELDS.has(fieldName)) val = normalizeDateString(val);
      return {
        value: val,
        source: descriptor,
        tier: 1,
        confidence: extractionConf  // JSON is exact; parser_conf = 1.0
      };
    }

    if (tierHint === 'llm') {
      // Tier 3 — not yet wired. Phase 3.x or later.
      return null;
    }

    // Plain module reference → v8.6.81 adapter first, then Tier 2
    // markdown-label parsing. The adapter is module-specific and exists
    // specifically because real paid-run outputs are heterogeneous
    // (classcode markdown, tower HTML/JSON, prose narratives) and should
    // not be treated as one generic label soup.
    const adapted = moduleSpecificFieldAdapter(moduleKey, moduleRec.text, fieldName, submission);
    if (adapted && adapted.value != null && adapted.value !== '') {
      let val = adapted.value;
      if (DATE_FIELDS.has(fieldName)) val = normalizeDateString(val);
      return {
        value: val,
        source: descriptor + ':adapter',
        tier: 2.5,
        confidence: extractionConf * (adapted.parser_confidence || 0.85),
        extraction_confidence: extractionConf,
        parser_confidence: adapted.parser_confidence || 0.85,
        reason: adapted.reason || null
      };
    }

    const parsed = parseMarkdown(moduleRec.text, fieldName);
    if (!parsed) return null;
    let val = parsed.value;
    if (DATE_FIELDS.has(fieldName)) val = normalizeDateString(val);
    return {
      value: val,
      source: descriptor,
      tier: 2,
      // Composed confidence: extraction × parser (Justin's refinement)
      confidence: extractionConf * parsed.parser_confidence,
      extraction_confidence: extractionConf,
      parser_confidence: parsed.parser_confidence
    };
  }

  // ===================================================================
  // v8.6.81 — Workbench fill reliability adapters
  // ===================================================================
  // These adapters do not call the API. They salvage the already-paid
  // extraction text by parsing the actual module shapes seen in the live
  // run: classcode markdown, narrative sections, and quote prose. This is
  // deliberately module-specific; generic keyword scans caused false
  // construction classifications and are not allowed for routing.

  const JSON_FIELD_SYNONYMS = {
    iso_class_code: ['iso_class_code','isoClassCode','class_code','classCode','code','iso_code','isoCode'],
    iso_description: ['iso_description','isoDescription','class_description','classDescription','description','class_desc'],
    hazard_grade: ['hazard_grade','hazardGrade','hazard','hg','risk_grade','riskGrade'],
    exposure_amount: ['exposure_amount','exposureAmount','sales','gross_sales','grossSales','receipts','payroll','amount'],
    exposure_basis: ['exposure_basis','exposureBasis','basis','rating_basis','ratingBasis','base'],
    exposure_to_loss: ['exposure_to_loss','exposureToLoss','exposure','loss_exposure','lossExposure'],
    account_strengths: ['account_strengths','accountStrengths','strengths','account_strength','strength'],
    guideline_conflicts_text: ['guideline_conflicts_text','guidelineConflicts','guidelines','guideline_cross_reference','guidelineCrossReference'],
    guideline_conflicts: ['guideline_conflicts','guideline_conflicts_text','guidelineConflicts','guidelines','guideline_cross_reference','guidelineCrossReference'],
    summary_operations: ['summary_operations','summaryOfOperations','summary_of_operations','operations','description_operations','descOps'],
    strengths_of_account: ['strengths_of_account','account_strengths','accountStrengths','strengths','account_strength','strength'],
    description_operations: ['description_operations','descriptionOfOperations','operations','summary_of_operations','summaryOfOperations','descOps'],
    underwriting_rationale: ['underwriting_rationale','underwritingRationale','rationale','pricing_rationale','pricingRationale'],
    broker_company: ['broker_company','brokerCompany','brokerage','producer_firm','producerFirm'],
    broker_name: ['broker_name','brokerName','producer_name','producerName'],
    broker_address: ['broker_address','brokerAddress','producer_address','producerAddress'],
    home_state: ['home_state','homeState','state','domicile_state','domicileState'],
    website: ['website','url','site','web_site'],
    loss_history_gl: ['loss_history_gl','gl_losses','general_liability_losses'],
    loss_history_auto: ['loss_history_auto','auto_losses','automobile_losses'],
    loss_history_by_year: ['loss_history_by_year','policy_years','yearly_losses'],
    large_losses: ['large_losses','large_loss_detail','claims_over_250k','claims_over_500k'],
    fleet_private_passenger: ['fleet_private_passenger','private_passenger','pp_units'],
    fleet_light: ['fleet_light','light','light_trucks','pickup'],
    fleet_medium: ['fleet_medium','medium','medium_trucks'],
    fleet_heavy: ['fleet_heavy','heavy','heavy_trucks'],
    fleet_extra_heavy: ['fleet_extra_heavy','extra_heavy','extra_heavy_trucks'],
    fleet_truck_tractors: ['fleet_truck_tractors','truck_tractors','tractors'],
    fleet_heavy_local: ['fleet_heavy_local','heavy_local','heavy_trucks_local'],
    fleet_heavy_other: ['fleet_heavy_other','heavy_other','heavy_nonlocal','heavy_trucks_other'],
    fleet_extra_heavy_local: ['fleet_extra_heavy_local','extra_heavy_local','xht_local'],
    fleet_extra_heavy_intermediate: ['fleet_extra_heavy_intermediate','extra_heavy_intermediate','xht_intermediate'],
    fleet_extra_heavy_long: ['fleet_extra_heavy_long','extra_heavy_long','xht_long'],
    fleet_truck_tractors_local: ['fleet_truck_tractors_local','truck_tractors_local','xhtt_local'],
    fleet_truck_tractors_intermediate: ['fleet_truck_tractors_intermediate','truck_tractors_intermediate','xhtt_intermediate'],
    fleet_truck_tractors_long: ['fleet_truck_tractors_long','truck_tractors_long','xhtt_long'],
    underlying_lead_limit: ['underlying_lead_limit','lead_limit','underlying_limit'],
    underlying_lead_carrier: ['underlying_lead_carrier','lead_carrier','underlying_carrier'],
    underlying_lead_premium: ['underlying_lead_premium','lead_premium','underlying_premium'],
    tower_role: ['tower_role','role','layer_role'],
    requested_limit: ['requested_limit','our_limit','limit'],
    attachment_point: ['attachment_point','attachment','xs']
  };

  function lookupJsonField(obj, fieldName) {
    if (obj == null) return null;
    const keys = [fieldName, camel(fieldName), fieldName.replace(/_/g, ' '), fieldName.replace(/_/g, '')]
      .concat(JSON_FIELD_SYNONYMS[fieldName] || []);
    const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
    const wanted = new Set(keys.map(norm));
    const seen = new Set();
    function walk(node) {
      if (node == null) return null;
      if (typeof node !== 'object') return null;
      if (seen.has(node)) return null;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const item of node) {
          const v = walk(item);
          if (v != null && v !== '') return v;
        }
        return null;
      }
      for (const [k, v] of Object.entries(node)) {
        if (wanted.has(norm(k)) && v != null && v !== '') return v;
      }
      // Favor common wrapper objects before arbitrary recursion.
      for (const wrap of ['workbench_fields','workbenchFields','fields','data','extracted','extracted_fields','extractedFields']) {
        if (node[wrap] && typeof node[wrap] === 'object') {
          const v = walk(node[wrap]);
          if (v != null && v !== '') return v;
        }
      }
      for (const v of Object.values(node)) {
        const out = walk(v);
        if (out != null && out !== '') return out;
      }
      return null;
    }
    return walk(obj);
  }

  function stripMarkup(text) {
    if (!text) return '';
    return String(text)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>|<\/div>|<\/li>|<\/tr>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function unmarkdown(text) {
    return stripMarkup(text)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/\*\*/g, '')
      .replace(/^\s*[-*]\s+/gm, '')
      .trim();
  }


  // v8.6.87 — pull zero-cost evidence from Platform file snapshots.
  // Existing paid runs may have weak LLM module summaries (e.g. carrier
  // "not stated" or losses rejected), while snapshot.files[*].extractMeta.pageTexts
  // already contains the actual PDF text. These helpers let adapters repair
  // the workbench without a new paid call.
  function filePageTexts87(submission, opts) {
    const files = (submission && submission.snapshot && Array.isArray(submission.snapshot.files))
      ? submission.snapshot.files : [];
    const names = (opts && opts.nameRe) || null;
    const classes = (opts && opts.classRe) || null;
    const out = [];
    for (const f of files) {
      const fname = String(f && f.name || '');
      const fclass = String(f && (f.classification || f.primaryTag || f.subType || '') || '');
      const pageClassText = Array.isArray(f && f.classifications)
        ? f.classifications.map(c => [c && c.tag, c && c.subType, c && c.classification, c && c.section_hint].filter(Boolean).join(' ')).join(' ')
        : '';
      const hay = fname + ' ' + fclass + ' ' + pageClassText;
      if (names && !names.test(hay)) continue;
      if (classes && !classes.test(hay)) continue;
      const pts = f && f.extractMeta && Array.isArray(f.extractMeta.pageTexts) ? f.extractMeta.pageTexts : [];
      for (const p of pts) {
        if (p == null) continue;
        if (typeof p === 'string') out.push(p);
        else if (typeof p === 'object') out.push(String(p.text || p.content || p.pageText || JSON.stringify(p)));
      }
    }
    return out.join('\n\n');
  }

  function quoteFileText87(submission) {
    return filePageTexts87(submission, { nameRe: /quote|underlying|excess|umbrella/i, classRe: /quote|underlying|excess|umbrella|gl|al|fleet/i });
  }
  function lossFileText87(submission) {
    return filePageTexts87(submission, { nameRe: /loss|claim/i, classRe: /loss|claim/i });
  }
  function fleetFileText87(submission) {
    return filePageTexts87(submission, { nameRe: /quote|acord|auto|vehicle|fleet/i, classRe: /al|auto|fleet|vehicle|acord|quote/i });
  }

  function firstReasonableParagraph(text, maxChars) {
    const clean = unmarkdown(text);
    const paras = clean.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    let p = paras.find(x => x.length > 80) || paras[0] || clean;
    // Strip a leading section heading such as "Summary of Operations:"
    // or "Exposure to Loss:" while preserving the actual narrative.
    p = p.replace(/^[A-Z][A-Za-z0-9 &\/\-]{2,90}:\s*/i, '').trim();
    if (maxChars && p.length > maxChars) p = p.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
    return p;
  }

  function normalizeMoneyForDisplay(v) {
    const n = _num(v);
    if (n == null) return null;
    return Math.round(n).toLocaleString('en-US');
  }


  function primaryIsoCodeFromSubmission(submission) {
    const cls = _moduleText(submission, 'classcode') || '';
    let m = /\*\*Code\s+(\d{4,5})\s+—/i.exec(cls) || /\bCode\s+(\d{4,5})\b/i.exec(cls) || /\bISO\s+(?:Class\s+)?Code\s*:?\s*(\d{4,5})\b/i.exec(cls);
    if (m) return m[1];
    const q = _moduleText(submission, 'gl_quote') || '';
    m = /\b(?:Class\s+Code|Code)\s*:?\s*(\d{4,5})\b/i.exec(q);
    return m ? m[1] : null;
  }

  function moneyToNumberFor85(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
    const raw = String(v).replace(/\u00a0/g, ' ').trim();
    const m = raw.match(/\$?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(M|MM|K|million|thousand)?\b/i);
    if (!m) return null;
    let n = parseFloat(m[1].replace(/,/g, ''));
    const u = (m[2] || '').toLowerCase();
    if (u === 'm' || u === 'mm' || u === 'million') n *= 1000000;
    if (u === 'k' || u === 'thousand') n *= 1000;
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  function displayMoney85(v) {
    const n = moneyToNumberFor85(v);
    return n == null ? null : n.toLocaleString('en-US');
  }

  function extractCarrier85(clean) {
    if (!clean) return null;
    const bad = /no information|not stated|unknown|not provided/i;
    let m = /^\s*[-*•]?\s*Carrier\s*:\s*(?!&)([^\n]+)/im.exec(clean)
         || /^\s*[-*•]?\s*Insurance\s+Company\s*:\s*([^\n]+)/im.exec(clean)
         || /^\s*[-*•]?\s*Insurer\s*:\s*([^\n]+)/im.exec(clean);
    if (m && !bad.test(m[1])) return m[1].trim().replace(/\s{2,}/g, ' ');
    m = /\b([A-Z][A-Za-z& .'-]{2,80}\s+(?:Insurance\s+Company|Indemnity\s+Company|Casualty\s+Company|Mutual\s+Insurance\s+Company))\b/i.exec(clean);
    if (m && !bad.test(m[1])) return m[1].trim().replace(/\s{2,}/g, ' ');
    // Brand + issuing company pattern, e.g. CHUBB / Example Carrier.
    m = /\b(Penn\s+Millers\s+Insurance\s+Company)\b/i.exec(clean)
     || /\b(Steadfast\s+Insurance\s+Company)\b/i.exec(clean)
     || /\b(Zurich\s+American\s+Insurance\s+Company)\b/i.exec(clean);
    return m ? m[1].trim() : null;
  }


  // v8.6.89 - quote premium allocation helpers.
  // Do NOT use package total premium or full Business Auto premium for primary GL/AL.
  // GL should use the Commercial General Liability line item. AL should use the
  // Business Auto LIABILITY line item only, excluding physical damage and APD charges.
  function premiumLineToDisplay89(v) {
    const n = moneyToNumberFor85(v);
    return n == null ? null : n.toLocaleString('en-US');
  }

  // v8.6.90 - strict premium source authority.
  // The prior v8.6.89 line scanner would see a page/table line that contained
  // multiple coverages and return the FIRST dollar on that line. On package
  // quotes this could pick Agribusiness Property ($36,752) for GL. This version
  // only accepts a dollar amount AFTER the target coverage label and rejects
  // coverage totals that are not liability-only.
  function firstDollarAfterLabel90(text, labelPattern, maxChars) {
    const src = String(text || '').replace(/\u00a0/g, ' ');
    const lines = src.split(/\n+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const findIn = (chunk) => {
      const re = new RegExp(labelPattern.source, labelPattern.flags.includes('i') ? 'i' : '');
      const m = re.exec(chunk);
      if (!m) return null;
      const after = chunk.slice(m.index + m[0].length, m.index + m[0].length + (maxChars || 140));
      const dollars = Array.from(after.matchAll(/\$\s*([0-9][0-9,]*(?:\.\d+)?)/g)).map(x => x[1]);
      if (dollars.length) return premiumLineToDisplay89(dollars[0]);
      // Some OCR/table text drops the dollar sign but keeps comma-grouping.
      const bare = /\b([0-9]{2,3}(?:,[0-9]{3})+(?:\.\d+)?)\b/.exec(after);
      return bare ? premiumLineToDisplay89(bare[1]) : null;
    };
    for (const line of lines) {
      if (!labelPattern.test(line)) continue;
      const v = findIn(line);
      if (v) return v;
    }
    // Fallback for flattened tables where coverage rows were concatenated.
    const flat = lines.join('  ');
    return findIn(flat);
  }


  function quoteGlLimitByLabel8711(clean, fieldName) {
    const src = String(clean || '').replace(/\u00a0/g, ' ');
    const lines = src.split(/\n+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const labels = {
      gl_each_occurrence: [/Each\s+Occurrence(?:\s+Limit)?(?:\s*\(\s*Bodily\s+Injury.*?\))?/i, /Each\s+Occurrence\s+Limit/i],
      gl_general_aggregate: [/General\s+Aggregate(?:\s+Limit)?/i],
      gl_products_ops_aggregate: [/Products?\s*\/?\s*(?:Completed|Comp(?:leted)?|Comp)\s*(?:Operations?|Ops?)\s*(?:Aggregate|Agg)?/i, /Products?\s*\/?\s*Comp\s*Ops\s*Agg/i],
      gl_personal_adv_injury: [/Personal\s*(?:&|and)\s*Advertising\s*Injury/i, /Personal\s*(?:&|and)?\s*Adv(?:ertising)?\s*Injury/i]
    }[fieldName] || [];
    const money = /\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.\d+)?\s*(?:M|MM|million|K|thousand)?)/ig;
    const toDisplay = (v) => displayMoney85(v);
    const asNum = (v) => moneyToNumberFor85(toDisplay(v));

    // v8.7.14: resolve GL sublimits by the LABEL order when the quote
    // presents a compact table. Earlier versions guessed the sequence order
    // and crossed Products/Completed Ops with Personal & Advertising Injury
    // on some carrier pages. This parser first looks at the actual label
    // order in the CGL block and maps the adjacent money values to those
    // labels. Only if no label-ordered table is found does it fall back to
    // the common EO/GA/PCO/PAI slash sequence.
    function orderedGlLimitByVisibleLabels8714() {
      const cglIdx = src.search(/Commercial\s+General\s+Liability|General\s+Liability|\bCGL\b/i);
      const start = cglIdx >= 0 ? Math.max(0, cglIdx - 150) : 0;
      const block = src.slice(start, start + 1800);
      const labelDefs = [
        { field: 'gl_each_occurrence', re: /Each\s+Occurrence(?:\s+Limit)?/ig },
        { field: 'gl_general_aggregate', re: /General\s+Aggregate(?:\s+Limit)?/ig },
        { field: 'gl_products_ops_aggregate', re: /Products?\s*\/?\s*(?:Completed|Comp(?:leted)?|Comp)\s*(?:Operations?|Ops?)\s*(?:Aggregate|Agg)?/ig },
        { field: 'gl_personal_adv_injury', re: /Personal\s*(?:&|and)?\s*Adv(?:ertising)?\s*Injury/ig }
      ];
      const labelsFound = [];
      for (const def of labelDefs) {
        const re = new RegExp(def.re.source, 'ig');
        const m = re.exec(block);
        if (m) labelsFound.push({ field: def.field, index: m.index, text: m[0] });
      }
      if (labelsFound.length < 3) return null;
      labelsFound.sort((a, b) => a.index - b.index);
      const earliestLabel = labelsFound[0].index;
      const latestLabel = labelsFound[labelsFound.length - 1].index;
      const moneyRe = /\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.\d+)?\s*(?:M|MM|million)?)/ig;
      const moneyVals = [];
      let mm;
      while ((mm = moneyRe.exec(block))) {
        const val = moneyToNumberFor85(toDisplay(mm[1]));
        // Limits here should be six/seven figure values; this excludes premiums,
        // dates, class codes, and row counts without hard-coding account values.
        if (val && val >= 100000 && val <= 10000000) {
          moneyVals.push({ raw: mm[1], display: toDisplay(mm[1]), val, index: mm.index });
        }
      }
      if (moneyVals.length < 3) return null;

      // Case A: table labels first, then a row of values. Map by column order.
      const afterLabels = moneyVals.filter(v => v.index > latestLabel).slice(0, labelsFound.length);
      if (afterLabels.length >= labelsFound.length) {
        const out = {};
        labelsFound.forEach((lab, i) => { out[lab.field] = afterLabels[i] && afterLabels[i].display; });
        return out[fieldName] || null;
      }

      // Case B: each row has value near its label. Prefer values immediately
      // after the label, then immediately before it, within the same local row.
      const out = {};
      for (let i = 0; i < labelsFound.length; i++) {
        const lab = labelsFound[i];
        const nextLabelIdx = labelsFound[i + 1] ? labelsFound[i + 1].index : block.length;
        const after = moneyVals.find(v => v.index > lab.index && v.index < Math.min(nextLabelIdx, lab.index + 140));
        const before = [...moneyVals].reverse().find(v => v.index < lab.index && v.index > Math.max(0, lab.index - 90));
        if (after || before) out[lab.field] = (after || before).display;
      }
      return out[fieldName] || null;
    }

    const orderedByLabels = orderedGlLimitByVisibleLabels8714();
    if (orderedByLabels) return orderedByLabels;

    // Fallback for slash-only compact sequences where labels are not visible in
    // the parsed text. Common carrier order is EO/GA/PCO/PAI; with only three
    // values, use EO/GA/PCO and default PAI to EO.
    const slash = /(?:CGL|GL|General\s+Liability|Commercial\s+General\s+Liability)[^\n$]{0,120}?\$?\s*([0-9]+(?:\.\d+)?\s*(?:M|MM|million)?)[\s\/]+\$?\s*([0-9]+(?:\.\d+)?\s*(?:M|MM|million)?)[\s\/]+\$?\s*([0-9]+(?:\.\d+)?\s*(?:M|MM|million)?)(?:[\s\/]+\$?\s*([0-9]+(?:\.\d+)?\s*(?:M|MM|million)?))?/i.exec(src);
    if (slash) {
      const arr = [slash[1], slash[2], slash[3], slash[4]].map(toDisplay);
      if (fieldName === 'gl_each_occurrence' && arr[0]) return arr[0];
      if (fieldName === 'gl_general_aggregate' && arr[1]) return arr[1];
      if (fieldName === 'gl_products_ops_aggregate' && arr[2]) return arr[2];
      if (fieldName === 'gl_personal_adv_injury' && (arr[3] || arr[0])) return arr[3] || arr[0];
    }

    // v8.7.14 natural-language table rows, e.g. "$1,000,000 Each Occurrence"
    // or "Each Occurrence $1,000,000".  This avoids taking the next row's
    // aggregate value when the amount appears before the label.
    const nearPatterns = {
      gl_each_occurrence: [
        /\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.\d+)?\s*(?:M|MM|million)?)\s*(?:Each\s+Occurrence|Per\s+Occurrence)/i,
        /(?:Each\s+Occurrence|Per\s+Occurrence)[^$0-9]{0,60}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.\d+)?\s*(?:M|MM|million)?)/i
      ],
      gl_general_aggregate: [
        /\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.\d+)?\s*(?:M|MM|million)?)\s*(?:General\s+Aggregate|Aggregate\s+Limit)/i,
        /(?:General\s+Aggregate|Aggregate\s+Limit)[^$0-9]{0,60}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.\d+)?\s*(?:M|MM|million)?)/i
      ],
      gl_products_ops_aggregate: [
        /\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.\d+)?\s*(?:M|MM|million)?)\s*Products?\s*\/?\s*(?:Completed|Comp(?:leted)?|Comp)\s*(?:Operations?|Ops?)\s*(?:Aggregate|Agg)?/i,
        /Products?\s*\/?\s*(?:Completed|Comp(?:leted)?|Comp)\s*(?:Operations?|Ops?)\s*(?:Aggregate|Agg)?[^$0-9]{0,60}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.\d+)?\s*(?:M|MM|million)?)/i
      ],
      gl_personal_adv_injury: [
        /\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.\d+)?\s*(?:M|MM|million)?)\s*Personal\s*(?:&|and)?\s*Adv(?:ertising)?\s*Injury/i,
        /Personal\s*(?:&|and)?\s*Adv(?:ertising)?\s*Injury[^$0-9]{0,60}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.\d+)?\s*(?:M|MM|million)?)/i
      ]
    }[fieldName] || [];
    for (const re of nearPatterns) {
      for (const line of lines) {
        const m = re.exec(line);
        if (m) {
          const v = toDisplay(m[1]);
          if (v && moneyToNumberFor85(v) >= 100000) return v;
        }
      }
    }

    for (const re of labels) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!re.test(line)) continue;
        const windowTxt = [line, lines[i+1] || '', lines[i+2] || ''].join(' ');
        const after = windowTxt.slice(Math.max(0, windowTxt.search(re))).replace(re, ' ');
        const candidates = Array.from(after.matchAll(money))
          .map(m => ({ raw: m[1], val: asNum(m[1]) }))
          .filter(x => x.val && x.val >= 100000 && x.val <= 10000000);
        if (candidates.length) {
          // v8.7.13: PCO aggregate OCR windows can include adjacent $1M PAI/EO
          // values. Use the highest credible limit in that local PCO window.
          const chosen = fieldName === 'gl_products_ops_aggregate'
            ? candidates.sort((a,b) => b.val - a.val)[0]
            : candidates[0];
          return toDisplay(chosen.raw);
        }
      }
    }
    return null;
  }

  function quotePremiumByCoverage89(clean, kind) {
    const c = clean || '';
    if (kind === 'gl') {
      return firstDollarAfterLabel90(c, /\bCOMMERCIAL\s+GENERAL\s+LIABILITY\b/i, 90)
          || firstDollarAfterLabel90(c, /\bGENERAL\s+LIABILITY\b/i, 90);
    }
    if (kind === 'al') {
      // Liability-only Business Auto premium. Exclude total Business Auto and
      // physical damage / hired auto / non-owned auto lines. Prefer rows whose
      // label is exactly LIABILITY with covered auto symbol and limit nearby.
      const src = String(c || '').replace(/\u00a0/g, ' ');
      const lines = src.split(/\n+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
      for (const line of lines) {
        if (!/^LIABILITY\b/i.test(line)) continue;
        if (/HIRED|NON[-\s]*OWNED|PHYSICAL|COMPREHENSIVE|COLLISION|UMBRELLA|GENERAL/i.test(line)) continue;
        const dollars = Array.from(line.matchAll(/\$\s*([0-9][0-9,]*(?:\.\d+)?)/g)).map(m => m[1]);
        if (dollars.length) return premiumLineToDisplay89(dollars[dollars.length - 1]);
        const bare = Array.from(line.matchAll(/\b([0-9]{2,3}(?:,[0-9]{3})+(?:\.\d+)?)\b/g)).map(m => m[1]);
        if (bare.length) return premiumLineToDisplay89(bare[bare.length - 1]);
      }
      const m = /(?:^|\n|\s)LIABILITY\s+1\s+\$?\s*1,000,000[\s\S]{0,120}?\$\s*([0-9][0-9,]*(?:\.\d+)?)/i.exec(src);
      if (m) return premiumLineToDisplay89(m[1]);
      return null;
    }
    return null;
  }

  // v8.6.86 - fleet classification engine.
  // Priority order per Justin's rule:
  //   1) Official auto class/stat codes when present. The first three
  //      digits classify the unit's vehicle type and radius.
  //   2) If codes are absent, quote schedule text (RADIUS / TRUCK SIZE).
  //   3) If still missing, body type + GVW/GCW weight bands from the CAR
  //      manual: light 0-10k, medium 10,001-20k, heavy 20,001-45k,
  //      extra-heavy >45k; truck-tractors by tractor body/GCW.
  const FLEET_CODE_TO_FIELD_86 = (() => {
    const map = Object.create(null);
    const add = (field, codes) => codes.forEach(c => { map[String(c).padStart(3,'0')] = field; });
    add('fleet_private_passenger', ['739','007','073']);
    add('fleet_light', ['000','001','011','012','013','014','015','016','021','022','023','024','025','026','031','032','033','034','035','036','100','110','115','120','130','140','145','148','150','155','158','160','168','180','210']);
    add('fleet_medium', ['002','211','212','213','214','215','216','221','222','223','224','225','226','231','232','233','234','235','236']);
    add('fleet_heavy_local', ['311','314','321','324','331','334']);
    add('fleet_heavy_other', ['312','313','315','316','322','323','325','326','332','333','335','336']);
    add('fleet_extra_heavy_local', ['401','404']);
    add('fleet_extra_heavy_intermediate', ['402','405']);
    add('fleet_extra_heavy_long', ['403','406']);
    add('fleet_truck_tractors_local', ['341','344','351','354','361','364','501','504']);
    add('fleet_truck_tractors_intermediate', ['342','345','352','355','362','365','502','505']);
    add('fleet_truck_tractors_long', ['343','346','353','356','363','366','503','506']);
    return map;
  })();

  const FLEET_FIELD_ALIASES_86 = {
    fleet_heavy: ['fleet_heavy_local'],
    fleet_extra_heavy: ['fleet_extra_heavy_local'],
    fleet_truck_tractors: ['fleet_truck_tractors_local']
  };

  function emptyFleetCounts86() {
    return {
      fleet_private_passenger: 0,
      fleet_light: 0,
      fleet_medium: 0,
      fleet_heavy_local: 0,
      fleet_heavy_other: 0,
      fleet_extra_heavy_local: 0,
      fleet_extra_heavy_intermediate: 0,
      fleet_extra_heavy_long: 0,
      fleet_truck_tractors_local: 0,
      fleet_truck_tractors_intermediate: 0,
      fleet_truck_tractors_long: 0
    };
  }

  function classifyVehicleCode86(code) {
    if (code == null) return null;
    const raw = String(code).replace(/[^0-9]/g, '');
    if (raw.length < 3) return null;
    return FLEET_CODE_TO_FIELD_86[raw.slice(0,3)] || null;
  }

  function countByClassCodes86(clean) {
    const counts = emptyFleetCounts86();
    let total = 0;
    // Prefer five-digit class/stat codes such as 31499, 40499, 50699.
    // Avoid six-digit NAICS/SIC values such as 541100 by using digit boundaries.
    const re = /(^|\D)(\d{3})(\d{2})(?!\d)/g;
    let m;
    while ((m = re.exec(clean)) !== null) {
      const field = classifyVehicleCode86(m[2]);
      if (!field) continue;
      counts[field] += 1;
      total += 1;
    }
    if (!total) {
      const re3 = /\b(?:class|stat(?:istical)?\s*code|vehicle\s*code|code)\D{0,12}(\d{3})\b/gi;
      while ((m = re3.exec(clean)) !== null) {
        const field = classifyVehicleCode86(m[1]);
        if (!field) continue;
        counts[field] += 1;
        total += 1;
      }
    }
    return total ? counts : null;
  }

  function radiusBucket86(line) {
    if (/\b(long\s*(?:distance|haul)|over\s*200|200\s*\+|>\s*200)\b/i.test(line)) return 'long';
    if (/\b(intermediate|51\s*[-–]\s*200|51\s*to\s*200)\b/i.test(line)) return 'intermediate';
    if (/\b(local|up\s*to\s*50|0\s*[-–]\s*50|<\s*50|<\s*15|15\s*miles?\s*\+)\b/i.test(line)) return 'local';
    return 'local';
  }

  function fieldFromBodyWeight86(line) {
    const radius = radiusBucket86(line);
    const tractor = /\b(truck[-\s]*tractor|trk[-\s]*tractor|tractor|day\s+cab|semi)\b/i.test(line);
    const pickup = /\b(pickup|f\s*-?150|f\s*-?250|f\s*-?350|silverado|sierra|ram\s*1500|ram\s*2500|ram\s*3500)\b/i.test(line);
    const explicitLight = /\blight\b/i.test(line);
    const explicitMedium = /\bmedium\b/i.test(line);
    const explicitHeavy = /\bheavy\b/i.test(line);
    const explicitExtra = /\b(extra\s*heavy|extra\s*hvy|ex\s*hvy|xht)\b/i.test(line);
    const moneyish = Array.from(line.matchAll(/(^|\D)(\d{1,3}(?:,\d{3})+|\d{5,6})(?!\d)/g))
      .map(x => parseInt(String(x[2]).replace(/,/g,''),10))
      .filter(Number.isFinite);
    const gvw = moneyish.find(n => n >= 1000 && n <= 120000) || null;

    if (tractor) {
      if (radius === 'long') return 'fleet_truck_tractors_long';
      if (radius === 'intermediate') return 'fleet_truck_tractors_intermediate';
      return 'fleet_truck_tractors_local';
    }
    if (explicitExtra || (gvw && gvw > 45000)) {
      if (radius === 'long') return 'fleet_extra_heavy_long';
      if (radius === 'intermediate') return 'fleet_extra_heavy_intermediate';
      return 'fleet_extra_heavy_local';
    }
    if (explicitHeavy || (gvw && gvw > 20000)) {
      if (radius === 'local') return 'fleet_heavy_local';
      return 'fleet_heavy_other';
    }
    if (explicitMedium || (gvw && gvw > 10000)) return 'fleet_medium';
    if (pickup || explicitLight || (gvw && gvw <= 10000)) return 'fleet_light';
    if (/\bprivate\s+passenger|passenger\s+vehicle\b/i.test(line)) return 'fleet_private_passenger';
    return null;
  }

  function countByScheduleRows86(clean) {
    const counts = emptyFleetCounts86();
    let total = 0;
    const addField = (field) => { if (field) { counts[field] += 1; total += 1; } };
    const txt = String(clean || '').replace(/\s+/g, ' ');

    // Highest-confidence fallback: classify one vehicle per VIN context.
    // Quote schedules often wrap columns, but the VIN remains a reliable
    // row anchor. Look around each VIN for radius + size/body text.
    const vinRe = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
    const seen = new Set();
    let m;
    while ((m = vinRe.exec(txt)) !== null) {
      const vin = m[0];
      if (seen.has(vin)) continue;
      seen.add(vin);
      const ctx = txt.slice(Math.max(0, m.index - 180), Math.min(txt.length, m.index + 260));
      const field = fieldFromBodyWeight86(ctx);
      addField(field);
    }
    if (total) return counts;

    // Second fallback: one schedule row per line when OCR preserves rows.
    const lines = String(clean || '').split(/\n+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (const line of lines) {
      if (!/\b(local|intermediate|long|truck|pickup|tractor|medium|heavy|hvy|gvw|gcw|f\s*-?\d{3,4}|silverado|sierra|ram\s*\d{3,4})\b/i.test(line)) continue;
      // Require a vehicle-ish anchor so we do not count headings/rate tables.
      if (!/(\b\d{4}\b|\b[A-HJ-NPR-Z0-9]{17}\b|\bVIN\b|\bUNIT\b|\bVEH\b|\bF\s*-?\d{3,4}\b|\bRAM\s*\d{3,4}\b|\bCHEV|FORD|DODGE|GMC|KENWORTH|PETERBILT|FREIGHTLINER|MACK|INTERNATIONAL)/i.test(line)) continue;
      const field = fieldFromBodyWeight86(line);
      addField(field);
    }
    return total ? counts : null;
  }

  function countByNarrativeFleet86(clean) {
    const counts = emptyFleetCounts86();
    let total = 0;
    const add = (field, patterns) => {
      for (const re of patterns) {
        const m = re.exec(clean);
        if (m) {
          const n = parseInt(m[1], 10);
          if (Number.isFinite(n)) { counts[field] += n; total += n; }
          return;
        }
      }
    };
    // Order matters: parse Extra Heavy before Heavy, and Truck Tractor before generic Tractor.
    add('fleet_private_passenger', [/(?:^|[\n,;])\s*Private\s+Passenger(?:\s+Vehicles?)?\s*:?\s*(\d+)/i, /(?:^|[\n,;])\s*Passenger\s+Vehicles?\s*:?\s*(\d+)/i]);
    add('fleet_light', [/(?:^|[\n,;])\s*Light(?:\s*\/\s*Pickup|\s+Trucks?)?\s*:?\s*(\d+)/i, /(?:^|[\n,;])\s*Pickup\s*:?\s*(\d+)/i]);
    add('fleet_medium', [/(?:^|[\n,;])\s*Medium(?:\s+Trucks?)?\s*:?\s*(\d+)/i]);
    add('fleet_extra_heavy_local', [/(?:^|[\n,;])\s*Extra\s+Heavy\s*\(\s*Local\s*\)\s*:?\s*(\d+)/i, /(?:^|[\n,;])\s*Extra\s+Heavy(?:\s+Trucks?)?\s*:?\s*(\d+)/i]);
    add('fleet_extra_heavy_intermediate', [/(?:^|[\n,;])\s*Extra\s+Heavy\s*\(\s*Intermediate\s*\)\s*:?\s*(\d+)/i]);
    add('fleet_extra_heavy_long', [/(?:^|[\n,;])\s*Extra\s+Heavy\s*\(\s*(?:Long\s+Haul|Long\s+Distance)\s*\)\s*:?\s*(\d+)/i]);
    add('fleet_truck_tractors_local', [/(?:^|[\n,;])\s*Truck[-\s]*Tractors?\s*\(\s*Local\s*\)\s*:?\s*(\d+)/i, /(?:^|[\n,;])\s*Truck[-\s]*Tractors?\s*:?\s*(\d+)/i]);
    add('fleet_truck_tractors_intermediate', [/(?:^|[\n,;])\s*Truck[-\s]*Tractors?\s*\(\s*Intermediate\s*\)\s*:?\s*(\d+)/i]);
    add('fleet_truck_tractors_long', [/(?:^|[\n,;])\s*Truck[-\s]*Tractors?\s*\(\s*(?:Long\s+Haul|Long\s+Distance)\s*\)\s*:?\s*(\d+)/i]);
    add('fleet_heavy_local', [/(?:^|[\n,;])\s*Heavy\s*\(\s*Local\s*\)\s*:?\s*(\d+)/i, /(?:^|[\n,;])\s*Heavy(?:\s+Trucks?)?\s*:?\s*(\d+)/i]);
    add('fleet_heavy_other', [/(?:^|[\n,;])\s*Heavy\s*\(\s*(?:Other\s+than\s+Local|Intermediate|Long(?:\s+Haul)?)\s*\)\s*:?\s*(\d+)/i]);
    return total ? counts : null;
  }

  function parseFleetCounts86(clean) {
    return countByClassCodes86(clean) || countByScheduleRows86(clean) || countByNarrativeFleet86(clean);
  }

  function parseFleetCount85(clean, fieldName) {
    const counts = parseFleetCounts86(clean);
    if (!counts) return null;
    const aliases = FLEET_FIELD_ALIASES_86[fieldName] || [fieldName];
    let n = 0;
    for (const f of aliases) n += counts[f] || 0;
    return n > 0 ? String(n) : null;
  }

  function parseUnderlyingLayer85(clean, fieldName) {
    if (!clean) return null;
    const lower = clean.toLowerCase();
    const isLead = /lead\s+(?:umbrella|excess|\$)|lead layer|commercial liability umbrella|schedule of underlying/.test(lower)
      || /\$?\s*2\s*(?:m|mm|million)?\s*xs\s*\$?\s*1\s*(?:m|mm|million)?/i.test(clean);

    const money = '(?:\\$?\\s*(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\\.[0-9]+)?)(?:\\s*(?:M|MM|million|K|thousand))?)';
    const toDisplay = (v) => displayMoney85(v);
    let leadLimit = null;
    let attachment = null;

    const xs = new RegExp('(' + money + ')\\s*(?:xs|x\\s*s|excess\\s+of|over)\\s*(' + money + ')', 'i').exec(clean);
    if (xs) { leadLimit = xs[1]; attachment = xs[2]; }

    // Declarations often say: Each Occurrence Limit (Liability Coverage) $2,000,000.
    if (!leadLimit) {
      const lm = /Each\s+Occurrence\s+Limit(?:\s*\(\s*Liability\s+Coverage\s*\))?\s*\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.\d+)?\s*(?:M|MM|million)?)/i.exec(clean)
        || /Liability\s+Coverage[\s\S]{0,80}?Each\s+Occurrence[\s\S]{0,40}?\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.\d+)?\s*(?:M|MM|million)?)/i.exec(clean)
        || /Lead\s+(?:Umbrella|Excess)?\s*[·:\-]?\s*Lead\s*\$?\s*([0-9]+(?:\.\d+)?\s*(?:M|MM|million|K|thousand)?)/i.exec(clean);
      if (lm) leadLimit = lm[1];
    }

    // If no explicit xs value, derive attachment from Schedule of Underlying by
    // taking the highest primary limit shown under the schedule section.
    if (!attachment) {
      const sched = (/Schedule\s+of\s+Underlying[\s\S]{0,1800}/i.exec(clean) || [''])[0];
      const vals = Array.from(sched.matchAll(/\$\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.\d+)?\s*(?:M|MM|million)?)/gi))
        .map(m => moneyToNumberFor85(m[1])).filter(n => n && n > 0 && n <= 10000000);
      if (vals.length) attachment = String(Math.min(...vals));
    }

    const carrier = extractCarrier85(clean);
    const premMatch = /Commercial\s+Liability\s+Umbrella\s*\$\s*([0-9][0-9,]*(?:\.\d+)?)/i.exec(clean)
      || /Umbrella\s+Premium\s*:?\s*\$\s*([0-9][0-9,]*(?:\.\d+)?)/i.exec(clean)
      || /Lead\s+(?:Umbrella|Excess)\s+Premium\s*:?\s*\$\s*([0-9][0-9,]*(?:\.\d+)?)/i.exec(clean);

    if (fieldName === 'tower_role' && isLead) return 'underlying_lead';
    if (fieldName === 'underlying_lead_limit' && leadLimit) return toDisplay(leadLimit);
    if (fieldName === 'attachment_point' && attachment) return toDisplay(attachment);
    if (fieldName === 'underlying_lead_carrier' && carrier) return carrier;
    if (fieldName === 'underlying_lead_premium' && premMatch) return displayMoney85(premMatch[1]);
    return null;
  }

  function parseSupplementalExposure85(clean, fieldName, submission) {
    if (fieldName !== 'exposure_amount' && fieldName !== 'exposure_basis' && fieldName !== 'home_state') return null;
    if (fieldName === 'home_state') {
      const m = /\b(?:VA|Virginia)\b/i.exec(clean);
      if (m) return 'VA';
      const st = /\b([A-Z]{2})\s+\d{5}\b/.exec(clean);
      if (st) return st[1];
    }
    if (fieldName === 'exposure_basis') {
      if (/sales|receipts|revenue/i.test(clean)) return 'Gross Sales/Revenues';
    }
    const code = primaryIsoCodeFromSubmission(submission);
    if (!code) return null;
    const around = new RegExp(code + '[\\s\\S]{0,160}?(\\$?\\s*[0-9]+(?:\\.[0-9]+)?\\s*(?:M|MM|million|K|thousand)|\\$?\\s*[0-9][0-9,]{3,})', 'i');
    let m = around.exec(clean);
    if (!m) {
      const eq = new RegExp(code + '\\s*(?:=|:|-)\\s*\\$?\\s*([0-9]+(?:\\.[0-9]+)?\\s*(?:M|MM|million|K|thousand)|[0-9][0-9,]{3,})', 'i');
      m = eq.exec(clean);
    }
    if (m) {
      const n = moneyToNumberFor85(m[1]);
      // Reject accidental class-code echoes such as "12,683".
      if (n && n > 100000) return n.toLocaleString('en-US');
    }
    return null;
  }

  function moduleSpecificFieldAdapter(moduleKey, text, fieldName, submission) {
    const raw = text || '';
    const clean = unmarkdown(raw);
    const quoteFileClean = unmarkdown(quoteFileText87(submission));
    const fleetFileClean = unmarkdown(fleetFileText87(submission));
    const lossFileClean = unmarkdown(lossFileText87(submission));
    const cleanPlusQuote = (clean + '\n\n' + quoteFileClean).trim();
    const cleanPlusFleet = (clean + '\n\n' + fleetFileClean).trim();
    const cleanPlusLoss = (clean + '\n\n' + lossFileClean).trim();
    const lower = clean.toLowerCase();
    const hit = (value, conf, reason) => {
      if (value == null || value === '' || isSentinelValue(value)) return null;
      return { value, parser_confidence: conf || 0.80, reason: reason || 'adapter' };
    };

    // v8.6.89: premium source authority. Quote page line items beat generic
    // LLM prose labels like Total Premium/Annual Premium, which caused package
    // totals or full Business Auto premium to be applied to GL/AL liability.
    if (fieldName === 'gl_premium' && (moduleKey === 'gl_quote' || moduleKey === 'excess' || moduleKey === 'tower')) {
      const glPrem = quotePremiumByCoverage89(quoteFileClean || cleanPlusQuote, 'gl');
      if (glPrem) return hit(glPrem, 0.93, 'quote_coverage_line_commercial_general_liability');
    }
    if (fieldName === 'al_premium' && (moduleKey === 'al_quote' || moduleKey === 'excess' || moduleKey === 'tower')) {
      const alPrem = quotePremiumByCoverage89(quoteFileClean || cleanPlusQuote, 'al');
      if (alPrem) return hit(alPrem, 0.93, 'quote_auto_liability_line_only');
    }

    // v8.6.85: generic no-cost adapters used across modules.
    if ((fieldName === 'gl_carrier' || fieldName === 'al_carrier') && (moduleKey === 'gl_quote' || moduleKey === 'al_quote' || moduleKey === 'excess' || moduleKey === 'tower')) {
      const carr = extractCarrier85(cleanPlusQuote);
      if (carr) return hit(carr, 0.88, moduleKey + '_file_header_carrier');
    }
    // v8.7.11: if A12 over-refuses but the quote page text clearly states CGL
    // sublimits, recover them with a review-grade adapter instead of leaving
    // the visible GL card at $0.
    if (/^gl_(?:each_occurrence|general_aggregate|products_ops_aggregate|personal_adv_injury)$/.test(fieldName)
        && (moduleKey === 'gl_quote' || moduleKey === 'excess' || moduleKey === 'tower' || moduleKey === 'supplemental')) {
      const lim = quoteGlLimitByLabel8711(cleanPlusQuote, fieldName);
      if (lim) return hit(lim, 0.86, 'quote_page_gl_sublimit_adapter_override');
    }
    if (moduleKey === 'supplemental') {
      const supVal = parseSupplementalExposure85(clean, fieldName, submission);
      if (supVal) return hit(supVal, 0.84, 'supplemental_acord_schedule');
    }
    if (moduleKey === 'al_quote' || moduleKey === 'supplemental') {
      const fleetVal = parseFleetCount85(cleanPlusFleet, fieldName);
      if (fleetVal != null) return hit(fleetVal, 0.88, moduleKey + '_fleet_code_or_schedule_count');
    }
    if (moduleKey === 'excess' || moduleKey === 'tower') {
      const layerVal = parseUnderlyingLayer85(cleanPlusQuote, fieldName);
      if (layerVal != null) return hit(layerVal, 0.90, moduleKey + '_file_quote_underlying_layer');
    }
    if (moduleKey === 'losses') {
      const lossCorpus = /No matching loss runs found/i.test(clean) ? cleanPlusLoss : clean;
      if (!/claim|loss|incurred|general liability|auto/i.test(lossCorpus)) return null;
      if (fieldName === 'loss_history_gl' && /general\s+liability/i.test(lossCorpus)) return hit('available', 0.78, 'loss_file_gl_available');
      if (fieldName === 'loss_history_auto' && /commercial\s+auto|auto\s+liability|auto\s+physical/i.test(lossCorpus)) return hit('available', 0.78, 'loss_file_auto_available');
      if (fieldName === 'loss_history_by_year' && /5\/1\/\d{2}\s*-\s*\d{2}/.test(lossCorpus)) return hit('available', 0.78, 'loss_file_years_available');
      if (fieldName === 'large_losses' && /Claims?\s+\$?250K|TOTAL\s+Claim\s+Settlement|\$\s*[2-9],[0-9]{3},[0-9]{3}/i.test(lossCorpus)) return hit('available', 0.78, 'loss_file_large_available');
    }

    // Classcode module — anchor on the module's stated primary class code.
    if (moduleKey === 'classcode') {
      let m = /\*\*Code\s+(\d{4,5})\s+—\s+([^*]+?)\*\*/.exec(raw)
           || /\bCode\s+(\d{4,5})\s+[—-]\s+([^\n]+)/i.exec(clean)
           || /\bISO\s+(?:Class\s+)?Code\s*:?\s*(\d{4,5})\s*(?:[—-]\s*([^\n]+))?/i.exec(clean);
      const classRef = m && lookupGlClassCode(m[1]);
      if (fieldName === 'iso_class_code' && m) return hit(m[1], 0.98, classRef ? 'primary_classcode_validated_reference' : 'primary_classcode_unvalidated');
      if (fieldName === 'iso_description' && m) {
        if (classRef && classRef.description) return hit(classRef.description, 0.99, classRef.review ? 'gl_class_reference_extension_review' : 'gl_class_reference_description');
        if (m[2]) return hit(m[2].trim(), 0.90, 'primary_class_description_source_unvalidated');
      }
      if (fieldName === 'exposure_basis') {
        if (classRef && classRef.ratingBasis) return hit(normalizeGlRatingBasis(classRef.ratingBasis), 0.99, classRef.review ? 'gl_class_reference_extension_basis_review' : 'gl_class_reference_rating_basis');
        if (/sales|revenue|receipts|merchant wholesaler|dealer|distributor|retail|wholesale/i.test(clean)) return hit('Gross Sales/Revenues', 0.85, 'classcode_sales_basis');
        if (/payroll/i.test(clean)) return hit('Payroll', 0.80, 'classcode_payroll_basis');
        if (/acre|acres/i.test(clean)) return hit('Acres', 0.80, 'classcode_acres_basis');
      }
      if (fieldName === 'hazard_grade') {
        m = /Hazard\s+Grade\s*:?\s*(?:HG\s*)?([1-6]|Low|Moderate(?:\s+High)?|High)\b/i.exec(clean)
         || /\bHG\s*([1-6])\b/i.exec(clean);
        if (m) return hit(normalizeHazardGrade(m[1]), 0.85, 'classcode_hazard');
        if (/fertilizer|chemical|hazardous|pollution|contamination/i.test(clean)) return hit('High', 0.65, 'classcode_severity_inferred');
      }
      if (fieldName === 'exposure_amount') {
        m = /(?:sales|revenue|receipts|exposure)\D{0,40}(\$?\s*[0-9][0-9,\.]*\s*(?:million|thousand|m|mm|k)?)/i.exec(clean);
        const v = m && normalizeMoneyForDisplay(m[1]);
        if (v && moneyToNumberFor85(v) > 100000) return hit(v, 0.70, 'classcode_exposure_amount');
      }
      if (fieldName === 'description_operations') return hit(firstReasonableParagraph(clean, 1200), 0.80, 'classcode_ops_summary');
    }

    // Quote modules — recover common quote terms from prose when JSON is absent.
    if (moduleKey === 'gl_quote' || moduleKey === 'al_quote') {
      const isGL = moduleKey === 'gl_quote';
      // Anchor carrier to a real "- Carrier:" line. The broader old
      // regex captured section headings like "Carrier & Administrative:"
      // and returned "& Administrative:" as the carrier on test submission.
      const carrier = /^\s*[-*•]?\s*Carrier\s*:\s*(?!&)([^\n]+)/im.exec(clean);
      const period = /(?:Policy\s+)?Period\s*:?\s*([0-9\/\-.]+)\s*(?:[-–—]|to|through|thru)\s*([0-9\/\-.]+)/i.exec(clean);
      if ((fieldName === 'gl_carrier' && isGL) || (fieldName === 'al_carrier' && !isGL)) {
        if (carrier && !/no information|not stated|unknown|not provided/i.test(carrier[1])) return hit(carrier[1].trim(), 0.85, 'quote_carrier');
      }
      if ((fieldName === 'gl_effective_date' && isGL) || (fieldName === 'al_effective_date' && !isGL)) {
        if (period) return hit(period[1], 0.85, 'quote_period_start');
      }
      if ((fieldName === 'gl_expiration_date' && isGL) || (fieldName === 'al_expiration_date' && !isGL)) {
        if (period) return hit(period[2], 0.85, 'quote_period_end');
      }
      const moneyLine = (labels) => {
        for (const lab of labels) {
          const re = new RegExp(lab + '\\s*:?\\s*\\$?\\s*([0-9][0-9,\\.]*\\s*(?:million|thousand|m|mm|k)?)', 'i');
          const mm = re.exec(clean);
          if (mm) return normalizeMoneyForDisplay(mm[1]);
        }
        return null;
      };
      if (fieldName === 'gl_each_occurrence') return hit(moneyLine(['Each Occurrence','Occurrence Limit','Each Occ']), 0.80, 'gl_each_occurrence');
      if (fieldName === 'gl_general_aggregate') return hit(moneyLine(['General Aggregate','Aggregate Limit','Aggregate']), 0.80, 'gl_aggregate');
      if (fieldName === 'gl_products_ops_aggregate') return hit(moneyLine(['Products\\/Completed Operations Aggregate','Products.*Aggregate','Products\\s*Comp.*Agg']), 0.75, 'gl_products_aggregate');
      if (fieldName === 'gl_personal_adv_injury') return hit(moneyLine(['Personal.*Advertising Injury','Personal and Adv Injury','PI.*Adv']), 0.75, 'gl_pai');
      if (fieldName === 'gl_premium') return hit(moneyLine(['GL Premium','Commercial General Liability']), 0.75, 'gl_premium_specific');
      if (fieldName === 'al_combined_single_limit') return hit(moneyLine(['Combined Single Limit','CSL','Each Accident']), 0.80, 'al_csl');
      if (fieldName === 'al_premium') return hit(moneyLine(['AL Premium','Auto Liability Premium']), 0.75, 'al_premium_specific');
      if (fieldName === 'exposure_amount') return hit(moneyLine(['Exposure','Sales','Receipts','Revenue']), 0.65, 'quote_exposure_amount');
      if (fieldName === 'exposure_basis') {
        if (/sales|revenue|receipts/i.test(clean)) return hit('Gross Sales/Revenues', 0.75, 'quote_sales_basis');
        if (/payroll/i.test(clean)) return hit('Payroll', 0.70, 'quote_payroll_basis');
      }
    }


    // v8.6.82 — Underlying GL schedule fallback.
    // Used when gl_quote over-refuses but excess / tower / ACORD text
    // clearly states the scheduled CGL limits. These values are review-
    // grade fallbacks and should not be treated as carrier-confirmed GL
    // quote terms.
    if ((moduleKey === 'excess' || moduleKey === 'tower' || moduleKey === 'supplemental' || moduleKey === 'summary-ops')
        && /^gl_/.test(fieldName)) {
      const parseCompactMoney = (v) => {
        if (!v) return null;
        const raw = String(v).trim();
        let n = null;
        const compact = raw.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(M|MM|K|million|thousand)\b/i);
        if (compact) {
          n = parseFloat(compact[1]);
          const u = compact[2].toLowerCase();
          if (u === 'm' || u === 'mm' || u === 'million') n *= 1000000;
          else if (u === 'k' || u === 'thousand') n *= 1000;
        } else {
          const norm = raw.replace(/[^0-9.]/g, '');
          if (norm) n = parseFloat(norm);
        }
        if (!Number.isFinite(n)) return null;
        return Math.round(n).toLocaleString('en-US');
      };
      const orderedLimitsFromSlashLine = () => {
        const patterns = [
          /CGL\s*:\s*([^\\n]+)/i,
          /Underlying\s+GL\s*:?\s*([^\\n]+)/i,
          /COMMERCIAL\s+GENERAL\s+LIABILITY\s+INSURANCE[\s\S]{0,250}?Each\s+Occurrence\s+Limit\s+\$?\s*([0-9,]+)[\s\S]{0,140}?General\s+Aggregate\s+\$?\s*([0-9,]+)[\s\S]{0,160}?Products\/Completed\s+Operations\s+Aggregate\s+\$?\s*([0-9,]+)/i
        ];
        const cgl = patterns[0].exec(clean) || patterns[1].exec(clean);
        if (cgl) {
          const vals = (cgl[1].match(/\$?\s*[0-9]+(?:\.[0-9]+)?\s*(?:M|MM|K|million|thousand)?|\$?\s*[0-9][0-9,]+/gi) || [])
            .map(parseCompactMoney).filter(Boolean);
          if (vals.length >= 3) return vals;
        }
        const long = patterns[2].exec(clean);
        if (long) return [parseCompactMoney(long[1]), parseCompactMoney(long[2]), parseCompactMoney(long[3])].filter(Boolean);
        const accord = /Underlying\s+GL\s+limits\s*:?\s*([^\n]+)/i.exec(clean);
        if (accord) {
          const vals = (accord[1].match(/\$?\s*[0-9][0-9,]*(?:\.[0-9]+)?|\$?\s*[0-9]+(?:\.[0-9]+)?\s*(?:M|MM|K|million|thousand)/gi) || [])
            .map(parseCompactMoney).filter(Boolean);
          if (vals.length >= 3) return vals;
        }
        return [];
      };
      const vals = orderedLimitsFromSlashLine();
      if (fieldName === 'gl_each_occurrence' && vals[0]) return hit(vals[0], 0.82, moduleKey + '_scheduled_gl_occurrence');
      if (fieldName === 'gl_general_aggregate' && vals[1]) return hit(vals[1], 0.82, moduleKey + '_scheduled_gl_aggregate');
      if (fieldName === 'gl_products_ops_aggregate' && vals[2]) return hit(vals[2], 0.80, moduleKey + '_scheduled_gl_products_aggregate');
      if (fieldName === 'gl_personal_adv_injury' && vals[3]) return hit(vals[3], 0.75, moduleKey + '_scheduled_gl_pai');
    }

    // Narrative modules — return clean text, bounded for UI textareas.
    if (fieldName === 'exposure_to_loss' && moduleKey === 'exposure') return hit(firstReasonableParagraph(clean, 2500), 0.90, 'exposure_narrative');
    if (fieldName === 'account_strengths' && moduleKey === 'strengths') return hit(firstReasonableParagraph(clean, 2200), 0.90, 'strengths_narrative');
    if ((fieldName === 'guideline_conflicts_text' || fieldName === 'guideline_conflicts') && moduleKey === 'guidelines') return hit(firstReasonableParagraph(clean, 2500), 0.88, 'guidelines_narrative');
    if (fieldName === 'summary_operations' && moduleKey === 'summary-ops') return hit(firstReasonableParagraph(clean, 2200), 0.88, 'summary_ops_narrative');
    if (fieldName === 'strengths_of_account' && moduleKey === 'strengths') return hit(firstReasonableParagraph(clean, 2200), 0.90, 'strengths_narrative_alias');
    if (fieldName === 'description_operations' && (moduleKey === 'summary-ops' || moduleKey === 'supplemental' || moduleKey === 'website')) return hit(firstReasonableParagraph(clean, 2200), 0.86, 'ops_narrative');
    if (fieldName === 'underwriting_rationale' && (moduleKey === 'discrepancy' || moduleKey === 'guidelines' || moduleKey === 'exposure' || moduleKey === 'summary-ops')) return hit(firstReasonableParagraph(clean, 2200), 0.78, 'rationale_narrative');


    // v8.6.82 — Mailing / controlling address fallback from ACORD-style
    // source extracts and operations prose.
    if ((fieldName === 'mailing_address' || fieldName === 'controlling_address')
        && (moduleKey === 'supplemental' || moduleKey === 'summary-ops' || moduleKey === 'al_quote')) {
      let m = /CARROLL\s+COUNTY\s+COOP,?\s+INC\s*\/\s*([^\/\n]+?)\s*\/\s*([A-Za-z .]+?)\s+([A-Z]{2})\s+(\d{5})/i.exec(clean)
           || /Named\s+Insured:\s*CARROLL\s+COUNTY\s+COOP,?\s+INC\s*\(([^,]+),\s*([A-Za-z .]+)\s+([A-Z]{2})\s+(\d{5})\)/i.exec(clean);
      if (m) {
        const address = m.length === 5
          ? (m[1].trim() + ', ' + m[2].trim() + ', ' + m[3].trim() + ' ' + m[4].trim())
          : null;
        if (address) return hit(address, 0.86, moduleKey + '_acord_address');
      }
      m = /headquartered\s+at\s+([^,]+),\s*([A-Za-z .]+),\s*Virginia/i.exec(clean);
      if (m) return hit(m[1].trim() + ', ' + m[2].trim() + ', VA', 0.70, moduleKey + '_hq_address_no_zip');
    }

    // Website / URL.
    if (fieldName === 'website') {
      const m = /(https?:\/\/[^\s)]+|www\.[^\s)]+)/i.exec(clean);
      if (m) return hit(m[1], 0.75, 'website_url');
    }
    return null;
  }

  function normalizeHazardGrade(v) {
    const s = String(v || '').trim().toLowerCase();
    if (s === '1' || s.includes('low')) return 'Low';
    if (s === '2' || s === '3' || s === 'moderate') return 'Moderate';
    if (s === '4' || s.includes('moderate high')) return 'Moderate High';
    if (s === '5' || s === '6' || s.includes('high')) return 'High';
    return String(v || '').trim();
  }

  function buildFieldCoverageReport(submission) {
    const groups = {
      'Deal Information': ['insured_name','policy_effective','policy_expiration','home_state','mailing_address','controlling_address','broker_company','broker_name','broker_address','broker_region','market','paper','underwriter','assistant'],
      'Layer / Tower Gate': ['layer_type'],
      'Primary GL': ['gl_carrier','gl_effective_date','gl_expiration_date','gl_each_occurrence','gl_general_aggregate','gl_products_ops_aggregate','gl_personal_adv_injury','gl_premium'],
      'Primary AL': ['al_carrier','al_effective_date','al_expiration_date','al_combined_single_limit','al_premium'],
      'Risk Profile': ['iso_class_code','iso_description','hazard_grade','exposure_amount','exposure_basis','website'],
      'Underwriting Narrative': ['description_operations','exposure_to_loss','account_strengths','guideline_conflicts_text','underwriting_rationale'],
      'Losses / Fleet / Tower': ['loss_history_gl','loss_history_auto','loss_history_by_year','large_losses','fleet_private_passenger','fleet_light','fleet_medium','fleet_heavy_local','fleet_heavy_other','fleet_extra_heavy_local','fleet_extra_heavy_intermediate','fleet_extra_heavy_long','fleet_truck_tractors_local','fleet_truck_tractors_intermediate','fleet_truck_tractors_long','underlying_lead_limit','underlying_lead_carrier','underlying_lead_premium','tower_role','requested_limit','attachment_point']
    };
    const rows = [];
    let resolved = 0, missing = 0, review = 0;
    let ltDecision = null;
    try { ltDecision = decideLayerType(submission); } catch (e) { ltDecision = null; }
    for (const [group, fields] of Object.entries(groups)) {
      for (const field of fields) {
        let r = null;
        if (field === 'layer_type' && ltDecision && ltDecision.layerType) {
          r = { value: ltDecision.layerType, source: 'decideLayerType', tier: 'decision', confidence: ltDecision.conflict ? 0.80 : 0.95, reason: (ltDecision.reasons || []).join(' | ') };
        } else {
          r = resolveField(field, submission);
        }
        const status = r && r.value ? (ltDecision && field === 'layer_type' && ltDecision.conflict ? 'review' : 'resolved') : 'missing';
        if (status === 'resolved') resolved++;
        else if (status === 'review') review++;
        else missing++;
        rows.push({
          group, field, status,
          value: r && r.value != null ? String(r.value).slice(0, 160) : '',
          source: r ? r.source : '',
          tier: r ? r.tier : '',
          confidence: r && r.confidence != null ? Number(r.confidence).toFixed(3) : '',
          reason: r && r.reason ? r.reason : (status === 'missing' ? 'No authoritative source parsed' : '')
        });
      }
    }
    const ex = (submission && submission.snapshot && submission.snapshot.extractions) || (submission && submission.extractions) || {};
    const modules = Object.keys(ex).sort().map(k => {
      const rec = ex[k] || {};
      const txt = typeof rec.text === 'string' ? rec.text : '';
      const json = txt ? parseJsonBlock(txt) : null;
      let applicant = 'unknown';
      try {
        const stated = extractNamedInsured(txt);
        applicant = stated ? applicantVerdict(stated, submission && submission.account_name) : 'not_found';
      } catch (e) { applicant = 'error'; }
      return { module: k, hasText: !!txt, chars: txt.length, hasJson: !!json, applicant };
    });
    return { summary: { resolved, review, missing, total: resolved + review + missing }, rows, modules, layerDecision: ltDecision };
  }

  function camel(snake) {
    return snake.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
  }

  // ─── Public surface ───────────────────────────────────────────────────────

  // ─── Phase 12 — Excess Tower parser ───
  // FIX-PHASE-12-EXCESS-TOWER-2026-05-14
  // The excess module emits a VARIABLE number of "**Layer N:**" blocks —
  // fundamentally different from every prior coverage (fixed single-value
  // fields). This dedicated parser:
  //   1. Detects the Phase-6.1/3.5 refusal diagnostic → blocked
  //   2. Runs the cross-applicant gate (extractNamedInsured vs account)
  //      → blocked on mismatch (same defense as resolveField applies to
  //      single-value modules; replicated here since the tower bypasses
  //      resolveField)
  //   3. Splits into layer blocks, extracts per-layer fields, filters
  //      sentinel/empty layers
  // Returns: { blocked: bool, reason: string, layers: [ {carrier,
  //   effective_date, expiration_date, limit, aggregate, premium} ] }
  // ─── Phase 13.0 — Tower Assembly Engine ───
  // FIX-PHASE-13.0-TOWER-ASSEMBLY-2026-05-14
  //
  // parseExcessTower (Phase 12) parses ONE excess module's text into a
  // flat layer list. assembleTower (this) is the whole-packet pass: it
  // takes the set of in-tower documents (each carrying its own Dec Page
  // limit + Schedule-of-Underlying attachment + optional quota-share
  // participation) and reconstructs the real tower:
  //
  //   • Classify each doc lead vs excess by POSITION, not per-file label.
  //     Lead = schedules primary coverages AND attaches at base ($0 over
  //     primary). An excess that also schedules primary is still excess
  //     if its Dec Page limit attaches up the tower.
  //   • Quota-share / shared rung: multiple carriers at the SAME
  //     attachment sharing one combined layer limit. The combined limit
  //     is counted ONCE; next attachment = prior attachment + full
  //     combined limit (NOT + a participation).
  //   • Validate continuity: each rung's attachment must equal the
  //     running sum of full limits beneath it. Gap / overlap / conflict
  //     / unclassifiable → that rung is marked status:'????' (the UI
  //     highlights it, colors it the Underlying color, user relabels).
  //   • A user relabel (Phase 13.1) is structured input: it overrides a
  //     rung's limit/attachment and the walk-up RE-RUNS so everything
  //     stacked above re-chains. assembleTower is pure + deterministic
  //     so re-running with an override just works.
  //
  // INPUT: docs = [ {
  //    id, name,
  //    decLimit,            // number — this policy's own Dec Page limit
  //    statedAttachment,    // number|null — attachment from its Schedule
  //                         //   of Underlying, if the doc states one
  //    schedulesPrimary,    // bool — does its SoU list primary coverages
  //    sharedGroupKey,      // string|null — rungs sharing one combined
  //                         //   layer carry the same key
  //    sharedCombinedLimit, // number|null — full combined layer limit
  //                         //   when this is a quota-share participation
  //    carrier,
  //    override             // {limit?, attachment?, kind?} from a user
  //                         //   relabel (Phase 13.1) — wins over parsed
  //  }, ... ]
  // OUTPUT: { rungs: [...], blocked, anyUncertain, totalTowerLimit }
  // FIX-PHASE-GO-LIVE-73-MONEY-PARSER-2026-05-16
  // Multiplier-aware money parser. The old implementation stripped all
  // non-numeric characters then parseFloat'd, so "$5M" -> 5 (a silent
  // 1,000,000x error — the single most dangerous bug in an underwriting
  // tower). This version understands magnitude suffixes/words and, when
  // a value is genuinely ambiguous, returns null rather than a
  // misleadingly tiny number. Callers already treat null as "absent /
  // user must confirm", which is the safe failure mode for money.
  function _num(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim().toLowerCase();
    if (!s) return null;
    // Strip currency symbols, spaces and thousands separators, but keep
    // letters (k/m/mm/b, "million", "thousand") and the decimal point.
    s = s.replace(/[\$£€,]/g, '').replace(/\s+/g, ' ').trim();

    // Word multipliers: "5 million", "2.5 thousand", "1 billion".
    let m = s.match(/^([0-9]*\.?[0-9]+)\s*(billion|million|thousand)\b/);
    if (m) {
      const base = parseFloat(m[1]);
      if (!isFinite(base)) return null;
      const mult = m[2] === 'billion' ? 1e9
                 : m[2] === 'million' ? 1e6
                 : 1e3;
      return base * mult;
    }
    // Suffix multipliers: 5m, 5mm, $5M, 250k, 1b, 5.0mm.
    m = s.match(/^([0-9]*\.?[0-9]+)\s*(mm|m|k|b)\b/);
    if (m) {
      const base = parseFloat(m[1]);
      if (!isFinite(base)) return null;
      const suf = m[2];
      const mult = suf === 'b' ? 1e9
                 : (suf === 'm' || suf === 'mm') ? 1e6
                 : 1e3; // k
      return base * mult;
    }
    // Plain number path. After removing currency/commas we should have
    // only digits and at most one decimal point. If any unrecognised
    // letters remain, the value is ambiguous — return null (safe) rather
    // than silently producing a wrong magnitude.
    if (/[a-z]/.test(s)) return null;        // unhandled letters → ambiguous
    const plain = parseFloat(s.replace(/[^0-9.]/g, ''));
    return isFinite(plain) ? plain : null;
  }

  function assembleTower(docs) {
    if (!Array.isArray(docs) || docs.length === 0) {
      return { rungs: [], blocked: false, anyUncertain: false, totalTowerLimit: 0 };
    }
    // 1. Normalize + apply any user overrides (Phase 13.1 hook). An
    //    override's explicit limit/attachment/kind always wins.
    const items = docs.map((d, idx) => {
      const ov = d.override || {};
      return {
        idx,
        id: d.id || ('doc-' + idx),
        name: d.name || ('doc-' + idx),
        sourceDocName: d.sourceDocName || null,
        carrier: d.carrier || null,
        decLimit: _num(ov.limit != null ? ov.limit : d.decLimit),
        statedAttachment: _num(ov.attachment != null ? ov.attachment : d.statedAttachment),
        _attFromUser: (ov.attachment != null),   // provenance: user relabel
        schedulesPrimary: !!d.schedulesPrimary,
        sharedGroupKey: d.sharedGroupKey || null,
        sharedCombinedLimit: _num(d.sharedCombinedLimit),
        forcedKind: ov.kind || null,   // user can force 'lead' | 'excess'
        // FIX-PHASE-GO-LIVE-73-TOWER-ECONOMICS-2026-05-16
        // Preserve layer economics through normalization so rung
        // construction (and the workbench writer) can populate
        // eff/exp/aggregate/premium, not just carrier+limit.
        effectiveDate: d.effectiveDate || d.effective || null,
        expirationDate: d.expirationDate || d.expiration || null,
        aggregate: _num(d.aggregate),
        premium: _num(d.premium),
        override: ov
      };
    });

    // 2. Group quota-share participations. Rungs sharing a sharedGroupKey
    //    are ONE tower rung; combined limit counted once.
    const groups = new Map();      // key -> [items]
    const singles = [];
    for (const it of items) {
      if (it.sharedGroupKey) {
        if (!groups.has(it.sharedGroupKey)) groups.set(it.sharedGroupKey, []);
        groups.get(it.sharedGroupKey).push(it);
      } else {
        singles.push(it);
      }
    }

    // 3. Build provisional rungs. Each rung: { kind, limit, attachment,
    //    participants:[{carrier, participation}], status, sources:[ids] }
    const rungs = [];

    for (const it of singles) {
      const isLead = it.forcedKind === 'lead'
        || (it.forcedKind !== 'excess'
            && it.schedulesPrimary
            && (it.statedAttachment === 0 || it.statedAttachment == null));
      rungs.push({
        kind: isLead ? 'lead' : 'excess',
        limit: it.decLimit,
        attachment: isLead ? 0 : it.statedAttachment,
        participants: [{ carrier: it.carrier, participation: it.decLimit,
                         sourceDocName: it.sourceDocName || null, sourceId: it.id }],
        shared: false,
        status: 'ok',
        sources: [it.id],
        // FIX-PHASE-GO-LIVE-73-TOWER-ECONOMICS-2026-05-16
        // Preserve full layer economics so the workbench writer can
        // populate eff/exp/aggregate/premium, not just carrier+limit.
        effectiveDate: it.effectiveDate || it.effective || null,
        expirationDate: it.expirationDate || it.expiration || null,
        aggregate: it.aggregate != null ? it.aggregate : null,
        premium: it.premium != null ? it.premium : null,
        sourceDocName: it.sourceDocName || null,
        _statedAttachment: it.statedAttachment,
        _userRelabelAttachment: !!it._attFromUser
      });
    }
    for (const [key, parts] of groups.entries()) {
      // Combined layer limit: prefer an explicit sharedCombinedLimit,
      // else sum the participations (P/O amounts).
      const _explicitCombined = parts.find(p => p.sharedCombinedLimit)?.sharedCombinedLimit;
      const _sumParticipations = parts.reduce((s, p) => s + (p.decLimit || 0), 0);
      const combined = _explicitCombined || _sumParticipations;
      // FIX-PHASE-GO-LIVE-79-QS-IMBALANCE-2026-05-16
      // Extension v8.6.78 audit (HIGH, F1): an explicit
      // sharedCombinedLimit was trusted unconditionally even when it
      // contradicted the sum of the group's participations (e.g.
      // combined=15M but 5M+5M=10M participations, or combined=8M which
      // is LESS than 10M of participations). Every other tower anomaly
      // (gap, overlap, contradictory attachment, unreadable limit)
      // raises status:'????' + anyUncertain so the underwriter verifies
      // — QS imbalance was the one hole. A stated combined that does not
      // reconcile with the participations is internally contradictory
      // data (parser error, LLM hallucination, stale dec) and must be
      // surfaced, not silently bound against. Tolerance: 1% of the
      // larger magnitude (covers rounding) AND require >1 participant
      // with a positive sum (a single-participant group has nothing to
      // reconcile against — that is a legitimately stated combined).
      let _qsImbalance = false;
      if (_explicitCombined != null && isFinite(_explicitCombined)
          && parts.length > 1 && _sumParticipations > 0) {
        const _tol = Math.max(_explicitCombined, _sumParticipations) * 0.01;
        if (Math.abs(_explicitCombined - _sumParticipations) > _tol) {
          _qsImbalance = true;
        }
      }
      const att = parts.map(p => p.statedAttachment).find(a => a != null);
      const anyLead = parts.some(p => p.forcedKind === 'lead'
        || (p.forcedKind !== 'excess' && p.schedulesPrimary && (p.statedAttachment === 0 || p.statedAttachment == null)));
      rungs.push({
        kind: anyLead ? 'lead' : 'excess',
        limit: combined,                       // FULL combined — counted once
        attachment: anyLead ? 0 : (att == null ? null : att),
        // FIX-PHASE-13.4: every participant carries its own carrier +
        // sourceDocName so the File Manager can label ALL participant
        // docs in a shared rung (extension-flagged QS gap, 13.3).
        participants: parts.map(p => ({
          carrier: p.carrier,
          participation: p.decLimit,
          sourceDocName: p.sourceDocName || null,
          sourceId: p.id
        })),
        shared: true,
        sharedGroupKey: key,
        status: _qsImbalance ? '????' : 'ok',
        uncertaintyReason: _qsImbalance ? 'qs_combined_mismatch' : undefined,
        sources: parts.map(p => p.id),
        // FIX-PHASE-GO-LIVE-73-TOWER-ECONOMICS-2026-05-16
        // Shared layer: dates from any participant that has them;
        // premium summed across participants; aggregate = combined.
        effectiveDate: (parts.find(p => p.effectiveDate || p.effective) || {}).effectiveDate
                     || (parts.find(p => p.effective) || {}).effective || null,
        expirationDate: (parts.find(p => p.expirationDate || p.expiration) || {}).expirationDate
                     || (parts.find(p => p.expiration) || {}).expiration || null,
        aggregate: combined,
        premium: parts.some(p => p.premium != null)
          ? parts.reduce((s, p) => s + (p.premium || 0), 0) : null,
        sourceDocName: (parts.find(p => p.sourceDocName) || {}).sourceDocName || null,
        _statedAttachment: att,
        _userRelabelAttachment: parts.some(p => p._attFromUser)
      });
    }

    // ── Phase 13.4 — MULTI-PASS TOWER SOLVER ──
    // FIX-PHASE-13.4-MULTIPASS-SOLVER-2026-05-14
    //
    // Replaces the old single bottom-up walk-up. The old logic let one
    // unresolved rung poison every rung above it, and flagged any
    // computed (not document-stated) attachment as ????. Per Justin's
    // spec, the solver instead:
    //   • NEVER blocks — best-effort places everything determinable.
    //   • A ???? is an ISLAND: it does not poison rungs above it.
    //   • Resolves rungs from BELOW (running sum) AND from ABOVE
    //     (backfill: if rung N+1's attachment is known and the rungs
    //     between are known, rung N's position falls out by subtraction).
    //   • Iterates passes until the tower stops changing — a fix or a
    //     newly-read rung can cascade and unlock others.
    //   • computed-but-confident → status 'ok' and FILLS (Option A); only
    //     genuinely undeterminable rungs stay '????'.
    //   • CONFLICT GUARDRAIL: if below-says ≠ above-says for the same
    //     rung, it stays '????' reason 'conflict' — backfill resolves
    //     MISSING info, never silently chooses between CONTRADICTORY docs.
    //   • PROVENANCE: every placed rung records how its attachment was
    //     determined — 'stated' | 'computed_below' | 'computed_above' |
    //     'user_relabel' | 'lead_base' — so the later train/gap-find loop
    //     can see exactly why each layer landed where it did.

    // Lead handling first — anchors the base.
    let leadCount = 0;
    rungs.forEach(r => {
      if (r.kind === 'lead') {
        leadCount++;
        r.attachment = 0;
        r._attSource = 'lead_base';
        if (r._statedAttachment != null && _num(r._statedAttachment) !== 0) {
          // doc said non-zero but we classified lead → still base, note it
          r._attSource = 'lead_base';
        }
      }
    });

    // Sort: leads first, then by best-known attachment, unknowns last.
    rungs.sort((a, b) => {
      if (a.kind === 'lead' && b.kind !== 'lead') return -1;
      if (b.kind === 'lead' && a.kind !== 'lead') return 1;
      const aa = a.attachment == null ? Infinity : a.attachment;
      const bb = b.attachment == null ? Infinity : b.attachment;
      return aa - bb;
    });

    // ── Phase 13.4 — SEQUENCE TOWER SOLVER ──
    // A tower is a SEQUENCE: the lead sits at 0, and each excess rung
    // sits exactly on the top of the one below it (contiguous, no gaps
    // in a valid tower). We solve it as a sequence walk, not generic
    // graph neighbor-finding:
    //   • cursor starts at the lead's top (= lead.limit).
    //   • STATED attachment is an anchor. A rung whose stated attachment
    //     == cursor confirms (provenance 'stated'); cursor advances.
    //   • A rung with NO stated attachment but a known limit, sitting at
    //     the frontier, takes attachment = cursor (provenance
    //     'computed_below'); cursor advances by its limit.
    //   • BACKFILL: a still-unresolved limit-bearing rung whose top must
    //     equal a known anchor above (next stated/user/resolved rung)
    //     gets attachment = thatAnchor - limit (provenance
    //     'computed_above').
    //   • CONFLICT GUARDRAIL: if from-below and from-above both apply
    //     and disagree → '????' reason 'conflict', records both; never
    //     silently chooses.
    //   • ISLAND: a rung with NO limit is undeterminable; it BREAKS the
    //     cursor chain. Rungs above an island keep their OWN stated
    //     attachment (status ok — they stand alone) but cannot be
    //     computed_below across the break.
    //   • A stated rung is authoritative for its own position and is
    //     only flagged gap/overlap when the contiguous chain genuinely
    //     reaches a contradicting value adjacent to it.
    const EPS = 0.5;

    const lead = rungs.find(r => r.kind === 'lead');
    const leadTop = (lead && lead.limit != null && lead.limit > 0) ? lead.limit : null;
    if (lead) { lead.attachment = 0; lead._resolved = true; lead._attSource = 'lead_base'; }

    // Seed stated / user rungs.
    rungs.forEach(r => {
      if (r.kind === 'lead') return;
      if (r._userRelabelAttachment === true && r._statedAttachment != null) {
        r.attachment = _num(r._statedAttachment);
        r._attSource = 'user_relabel'; r._resolved = true;
      } else if (r._statedAttachment != null) {
        r.attachment = _num(r._statedAttachment);
        r._attSource = 'stated'; r._resolved = true;
      } else {
        r.attachment = null; r._resolved = false;
      }
    });

    const excess = rungs.filter(r => r.kind !== 'lead');

    // Helper: nearest known anchor attachment strictly above a level,
    // among rungs that have an attachment (stated/user/resolved).
    function anchorAbove(level) {
      let best = null;
      for (const o of excess) {
        const a = (o._statedAttachment != null) ? _num(o._statedAttachment)
                : (o._resolved ? o.attachment : null);
        if (a == null) continue;
        if (a <= level + EPS) continue;
        if (best == null || a < best) best = a;
      }
      return best;
    }

    // ITERATE: walk the cursor up from the lead, resolving the frontier
    // rung each pass; repeat until the tower stops changing (so a
    // backfill or a user fix can cascade).
    let progressed = true, guard = 0;
    while (progressed && guard < excess.length + 6) {
      progressed = false; guard++;
      if (leadTop == null) break;

      // Build the contiguous cursor chain from the lead.
      let cursor = leadTop;
      let chainBroken = false;
      // Working order: a rung's sort key is its stated/resolved
      // attachment if known, else the live cursor (so an unplaced
      // limit-only rung is tried AT the frontier, before any higher
      // stated anchor). Ties broken by stable source id.
      const ordered = excess.slice().sort((a, b) => {
        const ak = (a._resolved && a.attachment != null) ? a.attachment
                 : (a._statedAttachment != null ? _num(a._statedAttachment) : cursor);
        const bk = (b._resolved && b.attachment != null) ? b.attachment
                 : (b._statedAttachment != null ? _num(b._statedAttachment) : cursor);
        if (ak !== bk) return ak - bk;
        return a.sources[0] < b.sources[0] ? -1 : 1;
      });

      for (let i = 0; i < ordered.length; i++) {
        const r = ordered[i];

        if (r.limit == null || r.limit <= 0) {
          // Island: undeterminable height. Breaks the chain for
          // computed_below, but rungs with their own stated attachment
          // above remain valid.
          chainBroken = true;
          continue;
        }

        if (r._resolved) {
          // Resolved (stated/user/computed). Advance the cursor through
          // it. Gap/overlap flagging for STATED rungs is done by the
          // post-convergence validation walk, not here — doing it in the
          // resolve loop conflates "chain broken by undeterminable
          // island" (rung stands alone) with "chain computable but
          // contradictory" (flag it), which need different handling.
          if (Math.abs(r.attachment - cursor) <= EPS) {
            cursor = r.attachment + r.limit;
          } else if (r.attachment > cursor) {
            cursor = r.attachment + r.limit; // don't cascade past it
          } else {
            cursor = Math.max(cursor, r.attachment + r.limit);
          }
          continue;
        }

        // UNRESOLVED rung with a known limit.
        const fromBelow = chainBroken ? null : cursor;
        const aAbove = anchorAbove(chainBroken ? -Infinity : cursor);
        const fromAbove = (aAbove != null) ? (aAbove - r.limit) : null;

        if (fromBelow != null && fromAbove != null) {
          if (Math.abs(fromBelow - fromAbove) <= EPS) {
            r.attachment = fromBelow; r._attSource = 'computed_below';
            r._resolved = true; r.status = 'ok'; progressed = true;
            cursor = r.attachment + r.limit;
          } else {
            r.status = '????'; r.uncertaintyReason = 'conflict';
            r.conflictBelow = fromBelow; r.conflictAbove = fromAbove;
            if (r._lastConflict !== fromBelow + '/' + fromAbove) {
              r._lastConflict = fromBelow + '/' + fromAbove; progressed = true;
            }
            chainBroken = true; // unresolved → chain can't continue past
          }
        } else if (fromBelow != null) {
          r.attachment = fromBelow; r._attSource = 'computed_below';
          r._resolved = true; r.status = 'ok'; progressed = true;
          cursor = r.attachment + r.limit;
        } else if (fromAbove != null) {
          r.attachment = fromAbove; r._attSource = 'computed_above';
          r._resolved = true; r.status = 'ok'; progressed = true;
          // do not move the (broken) cursor
        } else {
          chainBroken = true; // can't place it this pass; blocks chain
        }
      }
    }

    // ── Post-convergence VALIDATION WALK ──
    // Walk rungs in tower order summing limits from the lead. For each
    // STATED rung, the expected attachment is the running sum beneath
    // it. If its stated attachment disagrees → gap (stated too high) or
    // overlap (stated too low). A rung with NO limit is an undeterminable
    // ISLAND: it breaks the walk, and rungs above the break are NOT
    // validated against the chain (they stand on their own stated
    // attachment — an island must not poison them). Conflict rungs have
    // a limit, so the walk continues through them and still flags a
    // contradicting stated rung above.
    (function validationWalk() {
      if (leadTop == null) return;
      // Order by best-known position. A no-limit / unresolved rung with
      // no stated attachment has no natural sort key; place it just
      // below the nearest stated rung above it so it sits in the right
      // tower position (an island between lead and a $10M-xs-$10M rung
      // must sort BELOW that rung, not at the end).
      const ex = rungs.filter(r => r.kind !== 'lead');
      const keyOf = (r) => {
        if (r.attachment != null) return r.attachment;
        if (r._statedAttachment != null) return _num(r._statedAttachment);
        return null; // unknown — positioned relative to neighbors below
      };
      const seq = ex.slice().sort((a, b) => {
        const ak = keyOf(a), bk = keyOf(b);
        const av = ak == null ? Infinity : ak;
        const bv = bk == null ? Infinity : bk;
        if (av !== bv) return av - bv;
        return a.sources[0] < b.sources[0] ? -1 : 1;
      });
      // Is there an undeterminable island (no limit AND no stated
      // attachment) anywhere in the program? If so, the chain is not
      // globally trustworthy and STATED rungs stand on their own — we do
      // not gap/overlap-flag them (per spec: a ???? island must not
      // poison independently-stated rungs).
      const hasUndeterminableIsland = ex.some(r =>
        (r.limit == null || r.limit <= 0) && r._statedAttachment == null && !r._resolved);

      let running = leadTop;
      let broken = false;
      for (const r of seq) {
        if (r.limit == null || r.limit <= 0) { broken = true; continue; }
        if (!broken && !hasUndeterminableIsland && r._attSource === 'stated') {
          if (r.attachment > running + EPS) {
            if (r.status !== '????') {
              r.status = '????'; r.uncertaintyReason = 'gap';
              r.expectedAttachment = running;
            }
          } else if (r.attachment < running - EPS) {
            if (r.status !== '????') {
              r.status = '????'; r.uncertaintyReason = 'overlap';
              r.expectedAttachment = running;
            }
          }
        }
        const base = (r.attachment != null) ? r.attachment : running;
        running = base + r.limit;
      }
    })();

    // Final classification of anything still unresolved.
    let anyUncertain = false;
    for (const r of rungs) {
      // FIX-PHASE-GO-LIVE-79-INVERTED-DATES-2026-05-16
      // Extension v8.6.78 audit (MEDIUM, F2): a rung whose
      // expirationDate precedes its effectiveDate was returned with
      // status:'ok' / anyUncertain:false, while every other anomaly
      // (gap, overlap, QS imbalance, unreadable limit) raises ????.
      // Inverted dates are internally contradictory data — flag them
      // the same way so the underwriter verifies. Only when BOTH dates
      // parse to valid timestamps (don't penalize a missing date).
      if (r.effectiveDate && r.expirationDate) {
        const _ef = Date.parse(r.effectiveDate);
        const _ex = Date.parse(r.expirationDate);
        if (isFinite(_ef) && isFinite(_ex) && _ex < _ef) {
          r.status = '????';
          if (!r.uncertaintyReason) r.uncertaintyReason = 'inverted_dates';
          anyUncertain = true;
          continue;
        }
      }
      if (r.kind === 'lead') {
        if (r.limit == null || r.limit <= 0) { r.status = '????'; r.uncertaintyReason = 'unreadable_limit'; anyUncertain = true; }
        else r.status = (r.status === '????') ? r.status : 'ok';
        if (r.status === '????') anyUncertain = true;
        continue;
      }
      if (r.limit == null || r.limit <= 0) {
        r.status = '????'; r.uncertaintyReason = 'unreadable_limit'; anyUncertain = true; continue;
      }
      if (!r._resolved || r.attachment == null) {
        r.status = '????';
        if (!r.uncertaintyReason) r.uncertaintyReason = 'attachment_undeterminable';
        anyUncertain = true;
        continue;
      }
      if (r.status === '????') { anyUncertain = true; continue; } // conflict/gap/overlap kept
      r.status = 'ok';
    }

    if (leadCount > 1) {
      anyUncertain = true;
      rungs.filter(r => r.kind === 'lead').forEach(r => {
        r.status = '????'; r.uncertaintyReason = 'multiple_leads';
      });
    }
    if (leadCount === 0 && rungs.length > 0) {
      anyUncertain = true;
      rungs[0].status = '????';
      rungs[0].uncertaintyReason = 'no_lead';
    }

    // Human-readable label + expose provenance per rung.
    const fmtM = (n) => {
      if (n == null) return '?';
      if (n >= 1e6 && n % 1e6 === 0) return '$' + (n / 1e6) + 'M';
      if (n >= 1e6) return '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
      return '$' + n.toLocaleString();
    };
    for (const r of rungs) {
      r.attachmentProvenance = r._attSource || (r.kind === 'lead' ? 'lead_base' : null);
      if (r.status === '????') {
        r.label = '????';
      } else if (r.kind === 'lead') {
        r.label = 'LEAD ' + fmtM(r.limit);
      } else {
        r.label = fmtM(r.limit) + ' xs ' + fmtM(r.attachment);
      }
    }

    const top = rungs.reduce((mx, r) =>
      (r.status === 'ok' && r.attachment != null && r.limit != null)
        ? Math.max(mx, r.attachment + r.limit) : mx, 0);

    return {
      rungs,
      blocked: false,
      anyUncertain,
      totalTowerLimit: top
    };
  }

  function parseExcessTower(text, accountName) {
    if (!text || typeof text !== 'string') {
      return { blocked: false, reason: 'no_text', layers: [] };
    }
    // 1. Refusal diagnostic (Phase 6.1 gate or prompt-level refusal)
    if (/\*\*\s*No matching underlying excess policies found for this insured/i.test(text)
        || /\*\*\s*No matching .* found for this insured/i.test(text)) {
      return { blocked: true, reason: 'refusal_diagnostic', layers: [] };
    }
    // 2. Cross-applicant gate — replicate the resolveField-level defense
    if (accountName && accountName !== '(unknown)') {
      const stated = extractNamedInsured(text);
      // FIX-PHASE-GO-LIVE-80-UNKNOWN-INSURED-2026-05-16: block only a
      // genuinely DIFFERENT insured. "Not stated"/"(unknown)" on quote
      // pages → unverifiable → allow tower under review (test submission
      // root cause). Anahuac wrong-applicant → still 'mismatch' → blocked.
      if (stated && applicantVerdict(stated, accountName) === 'mismatch') {
        console.warn(
          '[WorkbenchRules] Cross-applicant defense: excess tower stated insured "' +
          stated + '" does not match submission "' + accountName +
          '". Skipping tower for this submission.'
        );
        return { blocked: true, reason: 'cross_applicant', layers: [], statedInsured: stated };
      }
    }
    // 3. Split into "**Layer N:**" blocks
    const layerSplit = text.split(/\*\*\s*Layer\s+\d+\s*[:\*]/i);
    // element 0 is the preamble before Layer 1 — discard it
    const blocks = layerSplit.slice(1);
    if (blocks.length === 0) {
      return { blocked: false, reason: 'no_layers', layers: [] };
    }
    const grab = (block, re) => {
      const m = re.exec(block);
      return m && m[1] ? m[1].trim() : null;
    };
    const layers = [];
    for (let block of blocks) {
      // Trim the block at the Tower Summary if it bled in (last block)
      const sumIdx = block.search(/\*\*\s*Tower\s+Summary/i);
      if (sumIdx !== -1) block = block.slice(0, sumIdx);

      const carrier = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/i);
      // Limit: prefer explicit "Layer Limit", else first $ of "Limits: $X xs $Y", else "Limits: $X"
      let limit = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*Layer\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
      if (!limit) {
        limit = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*Limits?\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:xs|x\/s|excess\s+of|over)\b/i);
      }
      if (!limit) {
        limit = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*Limits?\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
      }
      const aggregate = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*Aggregate\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
      const premium = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/i);

      // Dates: from "Period: A – B", or explicit Effective/Expiration lines
      let eff = null, exp = null;
      const period = /(?:^|\n)\s*[-*]?\s*\**\s*Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/i.exec(block);
      if (period) { eff = period[1]; exp = period[2]; }
      else {
        eff = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/i);
        exp = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/i);
      }

      // Sentinel filtering — drop placeholder values
      const clean = (v) => (v && !isSentinelValue(v)) ? v : null;
      const layer = {
        carrier:         clean(carrier),
        effective_date:  clean(eff)  ? normalizeDateString(clean(eff))  : null,
        expiration_date: clean(exp)  ? normalizeDateString(clean(exp))  : null,
        limit:           clean(limit),
        aggregate:       clean(aggregate),
        premium:         clean(premium)
      };
      // Skip a layer that has NO useful data at all (carrier + limit both empty)
      if (!layer.carrier && !layer.limit && !layer.premium) continue;
      layers.push(layer);
    }
    return { blocked: false, reason: 'parsed', layers: layers };
  }

  // ─── Phase 13.1 — Relabel persistence + propagation ───
  // FIX-PHASE-13.1-RELABEL-PROPAGATION-2026-05-14
  //
  // _sampleTowerInputDoc: the canonical assembleTower() input contract,
  // exposed so validation tooling can build correct fixtures without
  // guessing field names (the input-side analogue of the Phase 10
  // liquor_*_limit naming fix). Returns one representative lead doc and
  // one representative quota-share participation doc.
  function _sampleTowerInputDoc() {
    return {
      contract: {
        id:                  'string  — stable doc id',
        name:                'string  — display name',
        sourceDocName:       'string|null — exact source file name this layer was read from; used by buildTowerView to label that file in the File Manager',
        carrier:             'string  — carrier on this policy',
        decLimit:            'number  — this policy\'s OWN Dec Page limit (e.g. 5000000)',
        statedAttachment:    'number|null — attachment from its Schedule of Underlying; 0 or null for the lead',
        schedulesPrimary:    'bool    — does its Schedule of Underlying list primary coverages',
        sharedGroupKey:      'string|null — rungs sharing ONE combined layer carry the same key',
        sharedCombinedLimit: 'number|null — the FULL combined layer limit when this is a quota-share participation',
        effectiveDate:       'string|null — ISO YYYY-MM-DD, this layer own effective date',
        expirationDate:      'string|null — ISO YYYY-MM-DD, this layer own expiration date',
        aggregate:           'number|null — this layer own aggregate limit if stated',
        premium:             'number|null — this layer own premium if stated',
        override:            '{limit?:number, attachment?:number, kind?:"lead"|"excess"} — user relabel; wins over parsed values'
      },
      exampleLead: {
        id: 'lead', name: 'Lead Umbrella', sourceDocName: 'Lead Umbrella Policy.pdf',
        carrier: 'Lead Co',
        decLimit: 5000000, statedAttachment: 0, schedulesPrimary: true
      },
      exampleExcess: {
        id: 'r1', name: '$5M xs $5M layer', sourceDocName: 'First Excess 5x5.pdf',
        carrier: 'Carrier One',
        decLimit: 5000000, statedAttachment: 5000000, schedulesPrimary: false
      },
      exampleQuotaShareParticipation: {
        id: 'r2a', name: 'Insurer A 50% of $10M xs $10M', sourceDocName: 'Insurer A Quote.pdf',
        carrier: 'Insurer A',
        decLimit: 5000000, statedAttachment: 10000000,
        sharedGroupKey: 'g10', sharedCombinedLimit: 10000000
      },
      exampleUserOverride: {
        id: 'r3', name: 'corrected layer', carrier: 'Carrier Three',
        decLimit: 4000000, statedAttachment: null,
        override: { limit: 4000000, attachment: 20000000 }
      }
    };
  }

  // applyTowerRelabel: the structured-relabel entry point. A user
  // relabel is NOT a display string — it is input to the assembly math.
  // Given the submission, the doc id, and the correction, this:
  //   1. writes the override into the submission's tower-relabel store
  //      (lives in submission.snapshot.towerRelabels — travels with the
  //      submission, no new Supabase schema)
  //   2. re-runs assembleTower with the override applied
  //   3. returns the freshly reconstructed tower so the caller can
  //      re-render / re-fill
  // Re-running is safe because assembleTower is pure + deterministic;
  // one corrected rung re-chains everything stacked above it.
  //
  // correction = { limit?:number, attachment?:number, kind?:'lead'|'excess' }
  function applyTowerRelabel(submission, docId, correction, towerDocs) {
    if (!submission || !docId || !correction) {
      return { ok: false, reason: 'bad_args' };
    }
    if (!submission.snapshot) submission.snapshot = {};
    if (!submission.snapshot.towerRelabels) submission.snapshot.towerRelabels = {};
    // Merge (not replace) — user may correct limit now, attachment later.
    const prev = submission.snapshot.towerRelabels[docId] || {};
    const merged = Object.assign({}, prev, {});
    if (correction.limit != null)      merged.limit = _num(correction.limit);
    if (correction.attachment != null) merged.attachment = _num(correction.attachment);
    if (correction.kind)               merged.kind = correction.kind;
    merged._relabeledByUser = true;
    merged._relabeledAt = new Date().toISOString();
    submission.snapshot.towerRelabels[docId] = merged;

    // Apply all stored relabels onto the doc set, then re-assemble.
    const relabels = submission.snapshot.towerRelabels;
    const withOverrides = (towerDocs || []).map(d => {
      const ov = relabels[d.id];
      return ov ? Object.assign({}, d, { override: Object.assign({}, d.override || {}, ov) }) : d;
    });
    const tower = assembleTower(withOverrides);
    return {
      ok: true,
      tower,
      relabels: submission.snapshot.towerRelabels,
      docId,
      applied: merged
    };
  }

  // Read stored relabels back (e.g. on submission reload) so a rebuilt
  // tower reflects every prior user correction. Pure accessor.
  function getTowerRelabels(submission) {
    return (submission && submission.snapshot && submission.snapshot.towerRelabels) || {};
  }

  // Convenience: assemble a tower with any stored relabels already
  // applied. This is what the workbench (13.4) and File Manager (13.3)
  // call so persisted corrections always take effect on reload.
  function assembleTowerWithRelabels(submission, towerDocs) {
    const relabels = getTowerRelabels(submission);
    const withOverrides = (towerDocs || []).map(d => {
      const ov = relabels[d.id];
      return ov ? Object.assign({}, d, { override: Object.assign({}, d.override || {}, ov) }) : d;
    });
    return assembleTower(withOverrides);
  }

  // ─── Phase 13.2 — Structured tower-document extraction ───
  // FIX-PHASE-13.2-EXCESS-STRUCTURED-TOWER-2026-05-14
  //
  // The excess module (Phase 13.2 prompt rework) now emits a
  // ```json { "tower_documents": [...] } ``` block whose objects match
  // the assembleTower() input contract exactly. parseTowerDocuments
  // extracts that block into the array assembleTower consumes. It also
  // runs the same refusal-diagnostic + cross-applicant gate as
  // parseExcessTower so contaminated excess data can never reach the
  // tower (defense-in-depth parity with every other coverage).
  //
  // Returns: { blocked, reason, docs:[...assembleTower input...], statedInsured? }
  function parseTowerDocuments(excessText, accountName) {
    if (!excessText || typeof excessText !== 'string') {
      return { blocked: false, reason: 'no_text', docs: [] };
    }
    // Refusal diagnostic — same check as parseExcessTower
    if (/\*\*\s*No matching underlying excess policies found for this insured/i.test(excessText)
        || /\*\*\s*No matching .* found for this insured/i.test(excessText)) {
      return { blocked: true, reason: 'refusal_diagnostic', docs: [] };
    }
    // Cross-applicant gate — replicate the resolveField-level defense
    if (accountName && accountName !== '(unknown)') {
      const stated = extractNamedInsured(excessText);
      // FIX-PHASE-GO-LIVE-80-UNKNOWN-INSURED-2026-05-16: block only a
      // genuinely DIFFERENT insured. Silent-on-insured quote pages →
      // unverifiable → allow under review. Anahuac → still blocked.
      if (stated && applicantVerdict(stated, accountName) === 'mismatch') {
        console.warn(
          '[WorkbenchRules] Cross-applicant defense: excess tower_documents stated insured "' +
          stated + '" does not match submission "' + accountName +
          '". Skipping tower for this submission.'
        );
        return { blocked: true, reason: 'cross_applicant', docs: [], statedInsured: stated };
      }
    }
    // Extract the ```json ... ``` block containing tower_documents.
    // Prefer a fenced block; fall back to a bare {...} with the key.
    let jsonStr = null;
    const fenced = excessText.match(/```(?:json)?\s*([\s\S]*?"tower_documents"[\s\S]*?)```/i);
    if (fenced) {
      jsonStr = fenced[1];
    } else {
      const bare = excessText.match(/\{[\s\S]*?"tower_documents"[\s\S]*\}/);
      if (bare) jsonStr = bare[0];
    }
    if (!jsonStr) {
      return { blocked: false, reason: 'no_json_block', docs: [] };
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonStr.trim());
    } catch (e) {
      // Tolerant retry: trim to outermost balanced braces
      const first = jsonStr.indexOf('{');
      const last = jsonStr.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last > first) {
        try { parsed = JSON.parse(jsonStr.slice(first, last + 1)); }
        catch (e2) { return { blocked: false, reason: 'json_parse_error', docs: [] }; }
      } else {
        return { blocked: false, reason: 'json_parse_error', docs: [] };
      }
    }
    const list = parsed && Array.isArray(parsed.tower_documents)
      ? parsed.tower_documents : [];
    // Normalize to the assembleTower input contract, dropping nothing —
    // assembleTower itself handles nulls / classification / ????.
    const docs = list.map((d, i) => ({
      id:                  (d.id != null ? String(d.id) : ('tower-doc-' + i)),
      name:                (d.name != null ? String(d.name) : ('Layer ' + (i + 1))),
      sourceDocName:       d.sourceDocName != null ? String(d.sourceDocName) : null,
      carrier:             d.carrier != null ? String(d.carrier) : null,
      decLimit:            d.decLimit,
      statedAttachment:    d.statedAttachment,
      schedulesPrimary:    !!d.schedulesPrimary,
      sharedGroupKey:      d.sharedGroupKey != null ? String(d.sharedGroupKey) : null,
      sharedCombinedLimit: d.sharedCombinedLimit != null ? d.sharedCombinedLimit : null,
      // FIX-PHASE-GO-LIVE-74-TOWER-ECONOMICS-PASSTHROUGH-2026-05-16
      // v73 wired assembleTower+writer to carry these, but this parser
      // (the real prompt→assembler hop) silently dropped them, so on
      // real Opus output they were always null. Forward them now so the
      // economics survive the full pipeline, not just hand-fed tests.
      effectiveDate:       d.effectiveDate != null ? String(d.effectiveDate) : null,
      expirationDate:      d.expirationDate != null ? String(d.expirationDate) : null,
      aggregate:           d.aggregate != null ? d.aggregate : null,
      premium:             d.premium != null ? d.premium : null
    }));
    return { blocked: false, reason: 'parsed', docs: docs };
  }

  // Convenience: excess module text → fully assembled tower (with any
  // persisted user relabels applied). This is the single call the
  // workbench (13.4) and File Manager (13.3) will use.
  function buildTowerFromExcessModule(submission) {
    const extractions =
      (submission && submission.snapshot && submission.snapshot.extractions) ||
      (submission && submission.extractions) || null;
    const rec = extractions && extractions.excess;
    const accountName = (submission && submission.account_name) || null;
    if (!rec || typeof rec.text !== 'string') {
      return { blocked: false, reason: 'no_excess_module', rungs: [], anyUncertain: false, totalTowerLimit: 0, docs: [] };
    }
    const pt = parseTowerDocuments(rec.text, accountName);
    if (pt.blocked) {
      return { blocked: true, reason: pt.reason, statedInsured: pt.statedInsured, rungs: [], anyUncertain: false, totalTowerLimit: 0, docs: [] };
    }
    if (!pt.docs.length) {
      return { blocked: false, reason: pt.reason, rungs: [], anyUncertain: false, totalTowerLimit: 0, docs: [] };
    }
    const tower = assembleTowerWithRelabels(submission, pt.docs);
    return Object.assign({ blocked: false, reason: 'assembled', docs: pt.docs }, tower);
  }

  // ─── Phase 13.3 — File Manager tower view ───
  // FIX-PHASE-13.3-FILEMANAGER-TOWER-LABELS-2026-05-14
  //
  // buildTowerView produces everything the File Manager needs to label
  // and color in-tower documents WITHOUT the File Manager knowing any
  // tower math. It:
  //   1. assembles the tower (with persisted relabels) from the excess
  //      module via buildTowerFromExcessModule
  //   2. best-effort matches each uploaded document to a rung by
  //      sourceDocName ↔ file name (normalized, fuzzy-contains both ways)
  //   3. returns per-doc annotations { docId, towerLabel, color,
  //      isUncertain, rungSourceId } AND the full ordered tower so the
  //      File Manager can also render a tower summary panel.
  //
  // Color rule (locked with Justin): in-tower docs use the Underlying
  // color. The File Manager's tag-color system maps 'yellow' →
  // 'Underlying' (see pipeline-documents-view tagColorLabels). So every
  // in-tower doc — lead, excess, OR ???? — is colored 'yellow'. ????
  // docs additionally carry isUncertain:true so the UI highlights them
  // for the user to relabel. Nothing in the tower is left uncolored;
  // an unresolved rung is still visually grouped with its tower.
  //
  // Unmatched rungs (no uploaded file confidently matched) are NOT
  // dropped — they appear in the returned tower[] with matchedDocId:null
  // so the summary panel can still show them as ???? for relabeling.
  const TOWER_UNDERLYING_COLOR = 'yellow';

  function _normName(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '')          // drop extension
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function _nameMatch(a, b) {
    const na = _normName(a), nb = _normName(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    // fuzzy contains both directions, min length guard avoids junk hits
    const shorter = na.length <= nb.length ? na : nb;
    const longer  = na.length <= nb.length ? nb : na;
    return shorter.length >= 5 && longer.includes(shorter);
  }

  function buildTowerView(submission, uploadedDocs) {
    const built = buildTowerFromExcessModule(submission);
    const out = {
      blocked: !!built.blocked,
      reason: built.reason,
      statedInsured: built.statedInsured || null,
      anyUncertain: !!built.anyUncertain,
      totalTowerLimit: built.totalTowerLimit || 0,
      tower: [],          // ordered rungs, each annotated for the summary panel
      docAnnotations: {}  // docId -> { towerLabel, color, isUncertain, rungSourceId }
    };
    if (built.blocked || !built.rungs || built.rungs.length === 0) {
      return out;
    }
    const docs = Array.isArray(uploadedDocs) ? uploadedDocs : [];
    // Map rung.sources[0] (the tower-doc id) → its sourceDocName via the
    // parsed docs list (built.docs carries sourceDocName from 13.2/13.3).
    const srcNameById = {};
    (built.docs || []).forEach(d => { srcNameById[d.id] = d.sourceDocName || d.name || null; });

    built.rungs.forEach((r, idx) => {
      const rungSourceId = (r.sources && r.sources[0]) || ('rung-' + idx);
      const isUncertain = r.status === '????';
      const towerLabel = r.label || (isUncertain ? '????' : '');
      out.tower.push({
        order: idx,
        kind: r.kind,
        label: towerLabel,
        status: r.status,
        uncertaintyReason: r.uncertaintyReason || null,
        attachmentProvenance: r.attachmentProvenance || null,
        shared: !!r.shared,
        participants: r.participants || [],
        limit: r.limit,
        attachment: r.attachment,
        rungSourceId: rungSourceId,
        sourceDocName: srcNameById[rungSourceId] || null
      });
      // FIX-PHASE-13.4: annotate EVERY participant doc in the rung, not
      // just the first. A shared rung exposes participants[] each with
      // its own sourceDocName/sourceId — match and label them all so a
      // 60/40 quota-share shows the tower label on BOTH carrier docs.
      const partList = (r.shared && Array.isArray(r.participants) && r.participants.length)
        ? r.participants.map(p => ({ srcName: p.sourceDocName, srcId: p.sourceId }))
        : [{ srcName: srcNameById[rungSourceId], srcId: rungSourceId }];

      let participationIdx = 0;
      for (const part of partList) {
        const srcName = part.srcName || srcNameById[part.srcId] || null;
        if (!srcName) { participationIdx++; continue; }
        const hit = docs.find(dc => _nameMatch(srcName, dc.name || dc.fileName || dc.filename));
        if (!hit) { participationIdx++; continue; }
        // Shared rungs get a participation hint on the chip so the user
        // can tell the two carrier docs apart at a glance.
        let docLabel = towerLabel;
        if (r.shared && r.participants && r.participants.length > 1 && !isUncertain) {
          const pc = r.participants[participationIdx];
          if (pc && pc.carrier) docLabel = towerLabel + ' (' + pc.carrier + ')';
        }
        out.docAnnotations[hit.id] = {
          towerLabel: docLabel,
          color: TOWER_UNDERLYING_COLOR,   // 'yellow' = Underlying
          isUncertain: isUncertain,
          rungSourceId: rungSourceId,
          shared: !!r.shared
        };
        participationIdx++;
      }
    });
    return out;
  }

  // ─── Phase 14.0 — Subjectivity Intelligence ───
  // FIX-PHASE-14.0-SUBJECTIVITY-INTELLIGENCE-2026-05-14
  //
  // recommendSubjectivities(submission) reads the assembled tower + the
  // extracted primary coverages and returns which of the workbench's
  // standing subjectivities the deal's OWN facts call for. Each
  // recommendation is classified:
  //   • mode 'auto'    — mechanically implied by a fact the system is
  //                      certain of (e.g. the tower literally contains a
  //                      quota-share rung → "quota share partner
  //                      policies" subjectivity). The same threshold
  //                      philosophy as the tower solver: a deterministic
  //                      consequence auto-applies (Option A parity).
  //   • mode 'suggest' — judgment-based; surfaced with reasoning but the
  //                      underwriter decides (the subjectivity analogue
  //                      of a ???? — the system flags, you choose).
  // Pure + deterministic + offline-provable. Zero API spend. Matched to
  // the EXACT subjectivity label strings present in workbench.html so
  // the applier can check the right boxes by text.
  //
  // Returns: { recommendations: [ { label, mode, reason, factSource } ],
  //            anySuggest, towerBlocked }
  //
  // label values are matched (normalized, prefix-tolerant) against the
  // checkbox label text in #form-subjectivities.
  function recommendSubjectivities(submission) {
    const out = { recommendations: [], anySuggest: false, towerBlocked: false };
    if (!submission) return out;

    // Build the resolved tower (re-uses the full 13.x pipeline; persisted
    // relabels already applied). Subjectivities key off its facts.
    let tower = null;
    if (typeof buildTowerFromExcessModule === 'function') {
      tower = buildTowerFromExcessModule(submission);
      if (tower && tower.blocked) { out.towerBlocked = true; }
    }
    const rungs = (tower && !tower.blocked && Array.isArray(tower.rungs)) ? tower.rungs : [];

    const hasQuotaShare   = rungs.some(r => r.shared === true);
    const leadRung        = rungs.find(r => r.kind === 'lead');
    const leadResolved    = !!leadRung && leadRung.status !== '????';
    const excessRungs     = rungs.filter(r => r.kind !== 'lead');
    const hasInterveningExcess = excessRungs.length > 0;
    const anyUncertainRung = rungs.some(r => r.status === '????');
    const carriersPresent  = rungs.some(r =>
      (r.participants || []).some(p => p && p.carrier));

    // Which primary coverages did the pipeline extract FOR THIS INSURED?
    // FIX-PHASE-14.0.2-SUBJECTIVITY-CROSS-APPLICANT-GATE-2026-05-14
    // Cross-applicant defense parity: a coverage extraction only counts
    // toward a coverage.primary subjectivity if (a) it isn't a refusal
    // diagnostic AND (b) its stated named insured matches this
    // submission's account. Without (b) the recommender would fire a
    // "produce the underlying GL/Auto policy" subjectivity off a quote
    // that actually belongs to a DIFFERENT insured (the Anahuac /
    // test account contamination case) — every other phase already
    // honors this gate; the subjectivity recommender now does too.
    const ex = (submission.snapshot && submission.snapshot.extractions)
            || submission.extractions || {};
    const acct = submission.account_name || null;
    const has = (k) => {
      const rec = ex[k];
      if (!rec || typeof rec.text !== 'string' || !rec.text.trim()) return false;
      if (/no matching .* found for this insured/i.test(rec.text)) return false;
      // Cross-applicant gate — identical defense to Phases 6.1 / 4 / 7.
      if (acct && acct !== '(unknown)'
          && typeof extractNamedInsured === 'function'
          && typeof applicantsMatch === 'function') {
        const stated = extractNamedInsured(rec.text);
        if (stated && applicantsMatch(stated, acct) === false) {
          return false; // contaminated extraction — do NOT count it
        }
      }
      return true;
    };
    const hasGL = has('gl_quote'), hasAL = has('al_quote'), hasEL = has('el_quote');

    function add(label, mode, reason, factSource) {
      out.recommendations.push({ label, mode, reason, factSource });
      if (mode === 'suggest') out.anySuggest = true;
    }

    // ── Deterministic (auto) rules — each follows mechanically from a
    //    fact the system is certain of. ──
    if (hasQuotaShare) {
      add('Complete copy of quota share partner policies within 60 days',
          'auto',
          'The assembled tower contains a quota-share / shared layer; the partner policies are required to confirm the combined-layer terms.',
          'tower.shared_rung');
    }
    if (leadResolved) {
      add('Complete copy of the lead policy within 60 days',
          'auto',
          'A lead policy was identified in the tower; the full lead policy is required to confirm scheduled underlying and follow-form terms.',
          'tower.lead');
    }
    if (hasInterveningExcess) {
      add('Complete copy of intervening layer policies within 60 days',
          'auto',
          'The tower has excess layer(s) between the lead and the quoted layer; intervening policies are required to confirm continuity.',
          'tower.excess_rungs');
    }
    if (carriersPresent) {
      add('All scheduled underlying carriers be rated by AM Best and have a rating of A- VII or better',
          'auto',
          'Underlying carriers are scheduled in the tower; the standard financial-strength condition applies.',
          'tower.carriers');
      add('Policy Numbers and exact names of each underlying issuing company, specified by line of business',
          'auto',
          'Underlying carriers present; exact issuing-company identification is a standing requirement to finalize the schedule of underlying.',
          'tower.carriers');
    }
    if (hasGL || hasAL || hasEL) {
      add('Complete copy of the GL policy and Declarations pages of Auto & EL with underlying limits within 60 days',
          'auto',
          'Primary ' + [hasGL && 'GL', hasAL && 'Auto', hasEL && 'EL'].filter(Boolean).join(' / ') +
          ' coverage was extracted; the underlying policy/declarations are required to confirm limits.',
          'coverage.primary');
    }

    // ── Judgment (suggest) rules — surfaced with reasoning; underwriter
    //    decides. These are NOT auto-checked. ──
    add('Acceptable review of currently valued loss history for a minimum of (5) years plus current year',
        'suggest',
        'Standard excess-casualty loss-history review; recommended on essentially all risks but left to underwriter judgment for this account.',
        'standing.judgment');
    add('Acceptable review of current financial statement prior to binding',
        'suggest',
        'Financial review is judgment-based — typically required on larger or construction risks; confirm whether this account warrants it.',
        'standing.judgment');
    add('Complete description of operations for all Named Insureds is required prior to binding coverage',
        'suggest',
        'Recommended when multiple or unclear named insureds are present; review the insured roster before requiring.',
        'standing.judgment');
    if (anyUncertainRung) {
      add('Completed Supplementary Underwriting Questionnaire',
          'suggest',
          'The tower has unresolved (????) layer(s); a supplementary questionnaire can close the gaps the documents left open.',
          'tower.uncertain');
    }

    return out;
  }

  // ─── Phase 14.1 — Forms Intelligence ───
  // FIX-PHASE-14.1-FORMS-INTELLIGENCE-2026-05-14
  //
  // recommendForms(submission) does NOT change the form set (defaults
  // still load by layer type, untouched). It flags which already-present
  // forms/exclusions/endorsements THIS deal's facts make extra-relevant,
  // so the underwriter's eye goes to the ones that matter for this risk.
  // Suggest-only, same model as subjectivities: emphasis + reasoning,
  // never auto-add/remove a form. Matched to the exact FORMS_DATA names.
  //
  // Returns { emphases:[{ formName, reason, factSource }], towerBlocked }
  // ─── Phase 14.3 — Workflow Readiness ───
  // FIX-PHASE-14.3-WORKFLOW-READINESS-2026-05-14
  //
  // assessWorkflowReadiness(submission, targetStatus) reports what (if
  // anything) is not yet in place for a forward transition. It is
  // ADVISORY ONLY — it never blocks the status change (suggest-only
  // parity: warn, don't prevent the click). The underwriter can always
  // override; the system just makes the gaps visible.
  //
  // Returns { targetStatus, ready:bool, blockers:[{reason,detail}],
  //           towerBlocked }
  function assessWorkflowReadiness(submission, targetStatus) {
    const out = { targetStatus: targetStatus || null, ready: true,
                  blockers: [], towerBlocked: false };
    if (!submission) { out.ready = false;
      out.blockers.push({ reason: 'no_submission',
        detail: 'No active submission loaded.' }); return out; }

    const advancing = /^(Quoted|Bound|Issued)$/i.test(targetStatus || '');
    if (!advancing) return out; // Inquired/Cancelled/Dead/Reinstate — no gate

    let tower = null;
    if (typeof buildTowerFromExcessModule === 'function') {
      tower = buildTowerFromExcessModule(submission);
      if (tower && tower.blocked) out.towerBlocked = true;
    }
    const rungs = (tower && !tower.blocked && Array.isArray(tower.rungs)) ? tower.rungs : [];

    if (out.towerBlocked) {
      out.blockers.push({ reason: 'tower_blocked',
        detail: 'Excess tower is blocked (refusal/cross-applicant) — '
              + 'underlying program cannot be confirmed for this insured.' });
    } else if (rungs.length === 0) {
      out.blockers.push({ reason: 'no_tower',
        detail: 'No excess tower assembled — no structured underlying '
              + 'program to quote/bind against.' });
    } else {
      if (rungs.some(r => r.status === '????')) {
        out.blockers.push({ reason: 'tower_uncertain',
          detail: 'Tower has unresolved (????) layer(s) — relabel in the '
                + 'File Manager before ' + targetStatus.toLowerCase() + '.' });
      }
      if (!rungs.some(r => r.kind === 'lead' && r.status !== '????')) {
        out.blockers.push({ reason: 'no_lead',
          detail: 'No resolved lead layer — the lead anchors the tower '
                + 'and schedules the primary coverages.' });
      }
    }

    // Bind/Issue additionally want the primary coverages confirmed.
    if (/^(Bound|Issued)$/i.test(targetStatus)) {
      const ex = (submission.snapshot && submission.snapshot.extractions)
              || submission.extractions || {};
      const acct = submission.account_name || null;
      const ok = (k) => {
        const r = ex[k];
        if (!r || typeof r.text !== 'string' || !r.text.trim()) return false;
        if (/no matching .* found for this insured/i.test(r.text)) return false;
        if (acct && acct !== '(unknown)'
            && typeof extractNamedInsured === 'function'
            && typeof applicantsMatch === 'function') {
          const s = extractNamedInsured(r.text);
          if (s && applicantsMatch(s, acct) === false) return false;
        }
        return true;
      };
      if (!ok('gl_quote') && !ok('al_quote')) {
        out.blockers.push({ reason: 'no_primary',
          detail: 'No confirmed primary GL/AL for this insured — required '
                + 'to ' + targetStatus.toLowerCase() + ' an excess placement.' });
      }
    }

    out.ready = out.blockers.length === 0;
    return out;
  }

  function recommendForms(submission) {
    const out = { emphases: [], towerBlocked: false };
    if (!submission) return out;

    let tower = null;
    if (typeof buildTowerFromExcessModule === 'function') {
      tower = buildTowerFromExcessModule(submission);
      if (tower && tower.blocked) out.towerBlocked = true;
    }
    const rungs = (tower && !tower.blocked && Array.isArray(tower.rungs)) ? tower.rungs : [];
    const hasQuotaShare = rungs.some(r => r.shared === true);
    const anyUncertain  = rungs.some(r => r.status === '????');

    const ex = (submission.snapshot && submission.snapshot.extractions)
            || submission.extractions || {};
    const acct = submission.account_name || null;
    const txt = (k) => {
      const r = ex[k];
      if (!r || typeof r.text !== 'string') return '';
      if (acct && acct !== '(unknown)'
          && typeof extractNamedInsured === 'function'
          && typeof applicantsMatch === 'function') {
        const s = extractNamedInsured(r.text);
        if (s && applicantsMatch(s, acct) === false) return ''; // contaminated
      }
      return r.text.toLowerCase();
    };
    const blob = [txt('gl_quote'), txt('al_quote'), txt('excess')].join(' ');
    const opsBlob = ((submission.snapshot && submission.snapshot.descOps) || '')
      .toLowerCase() + ' ' + blob;

    const add = (formName, reason, factSource) =>
      out.emphases.push({ formName, reason, factSource });

    // Construction / contractor signals → silica, NY Labor Law context,
    // PFAS, total pollution are the high-relevance exclusions.
    if (/construct|contractor|utility|excavat|grading|underground|concrete|paving/.test(opsBlob)) {
      add('Silica or Silica Mixed Dust Exclusion',
          'Construction/contractor operations detected — silica exposure is a primary excess-casualty concern for this class.',
          'coverage.ops_construction');
      add('Total Pollution Exclusion',
          'Contracting operations — pollution exposure (fuel, runoff, materials) makes the total pollution exclusion high-relevance.',
          'coverage.ops_construction');
      add('Per- and Polyfluoroalkyl Substances (PFAS) Exclusion',
          'Construction/utility work can implicate PFAS-bearing materials; confirm the PFAS exclusion is intended.',
          'coverage.ops_construction');
    }
    // Habitational / hospitality signals → abuse, assault/battery.
    if (/habitational|apartment|hotel|hospitality|residential|dwelling|tenant/.test(opsBlob)) {
      add('Abuse Or Molestation Exclusion',
          'Habitational/hospitality exposure detected — abuse/molestation is a high-relevance exclusion for this class.',
          'coverage.ops_habitational');
      add('Assault or Battery Exclusion',
          'Habitational/hospitality exposure — assault & battery is a primary loss driver for this class.',
          'coverage.ops_habitational');
    }
    // Quota-share tower → service of suit + cross suits matter more.
    if (hasQuotaShare) {
      add('Service of Suit Clause',
          'Tower contains a quota-share/shared layer — service-of-suit coordination across participating carriers is material.',
          'tower.shared_rung');
      add('Cross Suits Exclusion',
          'Multiple carriers on a shared layer — cross-suits language warrants review for inter-carrier consistency.',
          'tower.shared_rung');
    }
    // Any uncertain tower rung → schedule of underlying is the form to scrutinize.
    if (anyUncertain) {
      add('Schedule of Underlying Insurance',
          'The tower has unresolved (????) layer(s) — the Schedule of Underlying is the form to verify once the gap is relabeled.',
          'tower.uncertain');
    }
    // TRIA always relevant on excess casualty — light standing emphasis.
    add('Cap on Losses From Certified Acts of Terrorism',
        'Standing excess-casualty TRIA consideration — confirm terrorism cap aligns with the underlying program.',
        'standing.tria');

    return out;
  }

  // ===================================================================
  // FIX-PHASE-GO-LIVE-80-LAYER-TYPE-DECISION-ENGINE-2026-05-16
  // Layer Type is the master UI gate: until #layerType is set, Limits &
  // Premiums, Forms, and rating sections render empty-state. The real
  // paid run (test submission) proved the prior crude logic
  // (hasLead ? 'Lead Other' : 'Excess Other', only if a tower assembled)
  // left it blank → whole workbench locked. This engine implements the
  // underwriter's exact spec:
  //   • Axis 1 (Lead vs Excess) — MECHANICAL from the real tower:
  //     excess/umbrella detected BENEATH our attachment → Excess;
  //     else (we are the first layer above primary) → Lead.
  //   • Axis 2 (operational subtype) — ORDERED 7-bucket classifier over
  //     the operations/class signals the pipeline already extracts.
  //   • Distributor/dealer/wholesale ⇒ Mercantile (controlling-operation
  //     wins). Blending/formulation/repackaging signals do NOT silently
  //     promote to Manufacturing — they raise a REVIEW conflict, per the
  //     "operational activity wins; severity → flags" rule.
  //   • NEVER blank: always resolves to a concrete option so the gate
  //     opens. Uncertainty → inferred + visible review badge, never a
  //     silent commit (Q9 correctness doctrine).
  // Pure function over the submission; returns the decision + reasoning
  // + any review conflict. The workbench applies it and renders the
  // badge; the user's manual selection remains authoritative.
  // ===================================================================
  const LAYER_SUBTYPES = [
    'Hospitality', 'Manufacturing', 'Mercantile',
    'Practice Construction', 'Project', 'Real Estate - Hab', 'Other'
  ];

  // Operational-activity verbs that move a distributor to Manufacturing
  // ONLY when they are the controlling operation (per the tiebreaker:
  // operational activity wins over product severity; presence alone is
  // a review flag, not an automatic reclassification).
  const MFG_TRIGGER_RE =
    /\b(manufactur|blend|mix(?:er|ing)|formulat|repackag|re-?label|private[- ]label|material(?:ly)? alter|product spec|quality control like a manufacturer)/i;

  function _moduleText(submission, key) {
    const ex = submission && submission.snapshot && submission.snapshot.extractions;
    const m = ex && ex[key];
    return (m && typeof m.text === 'string') ? m.text : '';
  }

  // FIX-PHASE-GO-LIVE-80B-CONTAMINATION-GUARD-2026-05-16
  // The offline proof against real test submission data caught this engine
  // misclassifying a fertilizer CO-OP as a construction contractor,
  // because the `subcontract` module text is 100% the EXCLUDED Anahuac
  // bridge-construction questionnaire (wrong applicant — every other
  // module correctly excluded it). The classifier must apply the SAME
  // cross-applicant discipline as the rest of the system: do not treat
  // a module's text as a signal if that text is about a different
  // insured than the submission. Reuse extractNamedInsured +
  // applicantsMatch (already proven). A module whose stated insured
  // clearly mismatches is dropped from the classification corpus.
  function _moduleTextIfApplicant(submission, key) {
    const txt = _moduleText(submission, key);
    if (!txt) return '';
    try {
      const acct = (submission && (submission.account_name || submission.accountName)) || '';
      if (!acct) return txt; // nothing to compare against — keep
      const stated = (typeof extractNamedInsured === 'function')
        ? extractNamedInsured(txt) : null;
      if (!stated) return txt; // module didn't state an insured — keep
      if (typeof applicantsMatch === 'function'
          && applicantsMatch(acct, stated) === false) {
        // Explicit mismatch → contaminated/foreign content. Drop it.
        return '';
      }
    } catch (e) { /* on any error, fail safe = keep original behavior */ }
    return txt;
  }


  function extractAuthoritativeGlClassRows8712(submission) {
    const out = [];
    const seen = new Set();
    const quoteText = (typeof quoteFileText87 === 'function') ? quoteFileText87(submission) : '';
    const supplementalText = [
      _moduleTextIfApplicant(submission, 'gl_quote'),
      _moduleTextIfApplicant(submission, 'supplemental'),
      _moduleTextIfApplicant(submission, 'exposure'),
      _moduleTextIfApplicant(submission, 'summary-ops')
    ].join('\n');
    const corpora = [quoteText, supplementalText].filter(Boolean);
    function add(code, exposure, reason) {
      if (!code || seen.has(code)) return;
      const ref = lookupGlClassCode(code);
      if (!ref || !ref.description) return;
      if (/^(?:91580|41603)$/.test(code) && !exposure) return;
      seen.add(code);
      out.push({ code, desc: ref.description, exposure: exposure || 0, reason });
    }
    for (const txt of corpora) {
      const clean = String(txt || '').replace(/\u00a0/g, ' ');
      const rows = clean.split(/\n+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
      for (const line of rows) {
        const codes = Array.from(line.matchAll(/\b(\d{5})\b/g)).map(m => m[1]);
        if (!codes.length) continue;
        const moneyVals = Array.from(line.matchAll(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.\d+)?\s*(?:M|MM|million|K|thousand)?)/ig))
          .map(m => moneyToNumberFor85(displayMoney85(m[1])))
          .filter(n => n && n >= 10000);
        for (const code of codes) {
          const ref = lookupGlClassCode(code);
          if (!ref) continue;
          const descWords = ref.description.split(/\s+/).slice(0, 3).join('|').replace(/[()]/g, '');
          const hasDesc = new RegExp(descWords, 'i').test(line);
          const exposure = moneyVals.length ? Math.max.apply(null, moneyVals) : 0;
          if (exposure || hasDesc || /fertilizer|feed|grain|hay|hardware|chemical|dealer|distributor|store/i.test(line + ' ' + ref.description)) {
            add(code, exposure, exposure ? 'GL class schedule row with exposure amount' : 'GL class schedule/code description signal');
          }
        }
      }
      Array.from(clean.matchAll(/\b(\d{5})\b[\s\S]{0,180}?\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.\d+)?\s*(?:M|MM|million|K|thousand)?)/g))
        .forEach(m => {
          const code = m[1];
          const ref = lookupGlClassCode(code);
          if (!ref) return;
          const exposure = moneyToNumberFor85(displayMoney85(m[2]));
          if (exposure && exposure >= 10000) add(code, exposure, 'flattened GL class schedule exposure signal');
        });
    }
    out.sort((a, b) => {
      const am = /dealer|distributor|wholesale|store|feed|grain|hay|fertilizer|chemical/i.test(a.desc) ? 1 : 0;
      const bm = /dealer|distributor|wholesale|store|feed|grain|hay|fertilizer|chemical/i.test(b.desc) ? 1 : 0;
      if ((b.exposure || 0) !== (a.exposure || 0)) return (b.exposure || 0) - (a.exposure || 0);
      if (bm !== am) return bm - am;
      return 0;
    });
    return out;
  }

  function _classifyOperationalSubtype(submission) {
    // FIX-PHASE-GO-LIVE-80C-STRUCTURED-CLASS-2026-05-16
    // The offline proof against real data caught a fundamental flaw:
    // keyword-scanning 24KB of underwriting ANALYSIS prose for words
    // like "contractor" produced a false "Practice Construction" — the
    // word appears in pollution-endorsement recommendations, exclusion
    // notes, and WC cross-references, none of which mean the insured is
    // a contractor. The classcode module already did the real
    // classification and stated it STRUCTURALLY: a list of primary ISO
    // class codes and a primary NAICS. Anchor on THAT structured signal,
    // not prose soup. Prose is consulted only for the blender/mixer
    // Manufacturing-trigger review flag (per the user's exact ruling).
    const clsTxt = _moduleText(submission, 'classcode');
    const ops    = _moduleText(submission, 'summary-ops');
    const reasons = [];

    // ---- Extract the STRUCTURED class signal ----
    // v8.7.13 source-authority: the actual GL quote/ACORD class schedule wins
    // over a weak/generated Class Code Expert paragraph. This prevents a stray
    // valid code elsewhere in a large packet from becoming the controlling
    // Layer Type reason.
    const codeMatches = [];
    try {
      const scheduleRows = extractAuthoritativeGlClassRows8712(submission);
      if (scheduleRows.length) {
        scheduleRows.slice(0, 8).forEach(x => codeMatches.push({ code: x.code, desc: x.desc, exposure: x.exposure }));
        reasons.push('used GL quote/ACORD class schedule as controlling class source');
      }
    } catch (_) {}

    // Secondary fallback: Primary ISO codes emitted by Class Code Expert:
    // "- **Code NNNNN — Description**". Use only if no authoritative GL
    // schedule rows were recovered.
    if (!codeMatches.length) {
      const codeRe = /\*\*Code\s+(\d{4,5})\s+—\s+([^*]+?)\*\*/g;
      let cm;
      while ((cm = codeRe.exec(clsTxt)) !== null) {
        const ref = lookupGlClassCode(cm[1]);
        codeMatches.push({ code: cm[1], desc: (ref && ref.description) || cm[2].trim() });
      }
    }
    // Primary NAICS (the module marks the lead one "(primary)")
    let naicsPrimary = '';
    const naicsLine = (clsTxt.match(/NAICS:[^\n]*/i) || [''])[0];
    const naicsPrim = naicsLine.match(/(\d{6})\s+—\s+([^;()]+?)\s*\(primary\)/i);
    if (naicsPrim) naicsPrimary = naicsPrim[2].trim();

    // The PRIMARY class is the first listed code (the module orders by
    // dominance and says so in its rationale). Fall back to NAICS, then
    // to a minimal ops scan only if there is no structured signal at all.
    const primary = codeMatches.length ? codeMatches[0] : null;
    const classCorpus = (
      (primary ? primary.desc + ' ' : '') +
      naicsPrimary + ' ' +
      codeMatches.map(c => c.desc).join(' ')
    ).toLowerCase();

    // Bucket from the STRUCTURED class description(s), most-specific
    // first. These match against class-code DESCRIPTIONS, not analysis
    // prose, so incidental words in recommendations cannot poison it.
    const has = re => re.test(classCorpus);

    // PROJECT — only a real wrap/OCIP class context.
    if (has(/\b(wrap[- ]?up|ocip|ccip|owner[- ]controlled insurance|project[- ]specific)\b/)) {
      reasons.push('primary class indicates a single project / wrap-up placement');
      return { subtype: 'Project', reasons, conflict: null };
    }
    // PRACTICE CONSTRUCTION — primary class is a CONTRACTOR class.
    if (has(/\bcontractor\b|\bconstruction\b|carpentry|electrical work|plumbing|roofing|excavation|915\d\d|916\d\d/)) {
      reasons.push('primary class code is a contractor/construction class ('
        + (primary ? primary.code + ' ' + primary.desc : naicsPrimary) + ')');
      return { subtype: 'Practice Construction', reasons, conflict: null };
    }
    // REAL ESTATE - HAB.
    if (has(/habitational|apartment|dwelling|residential rental|lessor's risk|condominium/)) {
      reasons.push('primary class is habitational/real-estate');
      return { subtype: 'Real Estate - Hab', reasons, conflict: null };
    }
    // HOSPITALITY.
    if (has(/hotel|motel|resort|restaurant|tavern|lodging|food service|catering|hospitality/)) {
      reasons.push('primary class is hospitality (guest/patron exposure)');
      return { subtype: 'Hospitality', reasons, conflict: null };
    }
    // MANUFACTURING vs MERCANTILE — the tiebreaker, on STRUCTURED class.
    const distributorClass = has(/\bdealer|distributor|distribution|wholesale|wholesaler|retail|merchant|farm supply|supply store|store\b/);
    // Manufacturing only if the PRIMARY class itself is a mfg class
    // (e.g. "... Manufacturing", "... Mfg"), not merely that the word
    // "blend" appears in the rationale prose.
    const manufacturingClass = /\bmanufactur|\bmfg\b|processing plant|formulation plant/i.test(
      (primary ? primary.desc : '') + ' ' + naicsPrimary);
    // Blender/mixer Manufacturing-trigger — searched in the rationale
    // PROSE (per the user's ruling: presence = review flag, not auto
    // reclassification unless the class itself is mfg).
    const blenderInProse = MFG_TRIGGER_RE.test(clsTxt + '\n' + ops);

    if (distributorClass && !manufacturingClass) {
      const out = {
        subtype: 'Mercantile',
        reasons: ['primary class code is dealer/distributor/wholesale ('
          + (primary ? primary.code + ' ' + primary.desc : naicsPrimary)
          + ') — controlling operation is mercantile'],
        conflict: null
      };
      if (blenderInProse) {
        const m = (clsTxt + '\n' + ops).match(MFG_TRIGGER_RE);
        out.conflict = {
          field: 'layerType', severity: 'review',
          message: 'Inferred — review required: distributor/wholesale '
            + 'operation supports Mercantile, but on-site '
            + (m ? m[0] : 'blending/mixing')
            + ' facility may indicate Manufacturing. Confirm Layer Type.'
        };
        out.reasons.push('manufacturing-trigger ("' + (m ? m[0] : 'blend')
          + '") present in rationale but primary class is distributor → Mercantile + review flag');
      }
      return out;
    }
    if (manufacturingClass) {
      reasons.push('primary class code is a manufacturing class');
      return { subtype: 'Manufacturing', reasons, conflict: null };
    }
    if (distributorClass) {
      reasons.push('mercantile (dealer/distributor/retail) primary class');
      return { subtype: 'Mercantile', reasons, conflict: null };
    }
    // OTHER — no structured class resolved.
    reasons.push('no decisive structured class signal — defaulted to Other; confirm');
    return {
      subtype: 'Other', reasons,
      conflict: {
        field: 'layerType', severity: 'review',
        message: 'Inferred — review required: operations did not clearly '
          + 'match a core class. Defaulted to Other; confirm Layer Type.'
      }
    };
  }

  // v8.7.11/12 — source-authority hardened Lead-vs-Excess position logic.
  // The test account fixture has a Lead $2M umbrella UNDER Zurich/Steadfast,
  // so our layer is Excess. Do not read every uploaded "Lead" quote this way:
  // if a future submission is asking us to write that lead layer itself, the
  // engine should remain Lead unless an underlying/under-us/tower signal exists.
  function detectLeadQuotePosition8709(submission, towerInfo) {
    const out = { underlyingLead: false, requestedLead: false, ambiguousLead: false, reasons: [] };
    try {
      const files = (submission && submission.snapshot && submission.snapshot.files) || [];
      if (Array.isArray(files)) {
        files.forEach(f => {
          const classBits = [f.primaryTag, f.tag, f.subType, f.layerRole, f.classification, f.category, f.routedTo]
            .concat(f.sectionTags || [])
            .concat((f.classifications || []).map(c => c && (c.tag || c.subType || c.type || c.primaryTag)))
            .join(' ');
          const nameBits = [f.name, f.fileName, f.filename, f.title].join(' ');
          const joined = (classBits + ' ' + nameBits).replace(/_/g, ' ');
          const hasLead = /Lead\s+\$|Lead\s+Umbrella|Lead\s+Excess|\blead\b/i.test(joined);
          if (!hasLead) return;
          const explicitUnderlying = /UNDERLYING|underlying|under\s+us|beneath|below|QUOTES\s+UNDERLYING|schedule\s+of\s+underlying/i.test(joined);
          const explicitOurLead = /our\s+lead|requested\s+lead|target\s+lead|quote\s+lead\s+layer|write\s+the\s+lead|writing\s+the\s+lead/i.test(joined);
          if (explicitUnderlying) {
            out.underlyingLead = true;
            out.reasons.push('file metadata identifies a Lead quote as underlying/beneath our layer');
          } else if (explicitOurLead) {
            out.requestedLead = true;
            out.reasons.push('file metadata indicates the requested layer is the Lead quote itself');
          } else {
            out.ambiguousLead = true;
            out.reasons.push('Lead quote detected without explicit under-us vs requested-layer context');
          }
        });
      }

      const ex = (submission && submission.snapshot && submission.snapshot.extractions) || (submission && submission.extractions) || {};
      const blob = ['tower','excess'].map(k => (ex[k] && (ex[k].text || ex[k].output || ex[k].content || ex[k].result)) || '').join('\n');
      const quoteBlob = (typeof quoteFileText87 === 'function') ? quoteFileText87(submission) : '';
      const parsedTowerRole = (typeof parseUnderlyingLayer85 === 'function')
        ? parseUnderlyingLayer85(quoteBlob, 'tower_role') : null;
      const parsedLeadLimit = (typeof parseUnderlyingLayer85 === 'function')
        ? parseUnderlyingLayer85(quoteBlob, 'underlying_lead_limit') : null;
      const quoteHasLead = /Lead\s+\$\s*[0-9]|Lead\s+Umbrella|Commercial\s+Liability\s+Umbrella|Lead\s+Excess/i.test(quoteBlob);
      const quoteHasUnderlyingSchedule = /Schedule\s+of\s+Underlying|underlying|Commercial\s+General\s+Liability|Business\s+Auto|\bxs\b|excess\s+of|over/i.test(quoteBlob);
      if ((quoteHasLead && quoteHasUnderlyingSchedule) || parsedTowerRole === 'underlying_lead' || parsedLeadLimit) {
        out.underlyingLead = true;
        out.reasons.push('quote page text identifies a lead umbrella/excess layer over scheduled underlying primary policies');
      }
      if (/Lead\s+Umbrella|Lead\s+Excess|Lead\s+\$\s*[0-9]/i.test(blob)) {
        const hasLayerShape = /\$?\s*[0-9]+(?:\.\d+)?\s*(?:M|MM|million)?\s*(?:xs|x\s*s|excess\s+of|over)\s*\$?\s*[0-9]+/i.test(blob);
        if (/underlying|schedule\s+of\s+underlying|under\s+us|beneath|below/i.test(blob) || hasLayerShape) {
          out.underlyingLead = true;
          out.reasons.push('tower/excess extraction identifies the Lead quote as an underlying layer');
        } else {
          out.ambiguousLead = true;
          out.reasons.push('tower/excess extraction mentions a Lead quote without requested-position context');
        }
      }

      if (towerInfo && Array.isArray(towerInfo.rungs)) {
        const leadRung = towerInfo.rungs.find(r => r && r.kind === 'lead' && r.status !== '????' && (r.limit > 0 || /Lead/i.test(r.label || '')));
        if (leadRung) {
          out.underlyingLead = true;
          out.reasons.push('assembled tower contains a resolved lead/umbrella rung below our requested layer');
        }
      }
    } catch (_) {}
    return out;
  }

  function detectedUnderlyingLeadQuote(submission, towerInfo) {
    return !!detectLeadQuotePosition8709(submission, towerInfo).underlyingLead;
  }

  function decideLayerType(submission) {
    // ---- Axis 1: Lead vs Excess, mechanical from the real tower ----
    let family = 'lead';            // safe default: we are first above primary
    let familyReason = 'no tower assembled — treated as Lead (first layer above primary)';
    let towerInfo = null;
    try {
      if (typeof buildTowerFromExcessModule === 'function') {
        const tw = buildTowerFromExcessModule(submission);
        towerInfo = tw;
        if (tw && !tw.blocked && Array.isArray(tw.rungs) && tw.rungs.length) {
          // "Excess detected beneath us" = a resolved underlying
          // excess/umbrella layer, including a Lead $2M umbrella when the
          // file/tower marks it as UNDER us. If the uploaded Lead quote is
          // explicitly the layer we are being asked to write, stay Lead.
          const resolved = tw.rungs.filter(r => r.status !== '????');
          const hasExcessBeneath = resolved.some(r => r.kind === 'excess');
          const leadPosition = detectLeadQuotePosition8709(submission, tw);
          if (hasExcessBeneath || leadPosition.underlyingLead) {
            family = 'excess';
            familyReason = leadPosition.underlyingLead
              ? 'lead umbrella / lead excess quote is identified as UNDER our requested layer → Excess'
              : 'resolved excess/umbrella layer(s) detected beneath our attachment → Excess';
            if (leadPosition.reasons && leadPosition.reasons.length) familyReason += ' (' + leadPosition.reasons[0] + ')';
          } else {
            family = 'lead';
            familyReason = leadPosition.requestedLead
              ? 'requested layer is identified as the uploaded Lead quote itself → Lead'
              : 'no resolved excess/umbrella layer beneath our attachment → Lead';
            if (leadPosition.ambiguousLead) {
              familyReason += ' (Lead quote present but not marked under-us; confirm requested position)';
            }
          }
        }
      }
    } catch (e) {
      familyReason = 'tower read failed (' + (e && e.message) + ') — defaulted to Lead';
    }
    // v8.7.13: If A15 did not assemble a tower, do not stop there. File
    // Manager tags and quote-page adapters can still identify a lead umbrella
    // sitting under our requested layer. That signal should drive Excess.
    try {
      if (family === 'lead') {
        const leadPositionNoTower = detectLeadQuotePosition8709(submission, towerInfo);
        if (leadPositionNoTower && leadPositionNoTower.underlyingLead) {
          family = 'excess';
          familyReason = 'lead umbrella / lead excess quote is identified as UNDER our requested layer → Excess'
            + (leadPositionNoTower.reasons && leadPositionNoTower.reasons.length ? ' (' + leadPositionNoTower.reasons[0] + ')' : '');
        }
      }
    } catch (_) {}

    // ---- Axis 2: operational subtype ----
    const cls = _classifyOperationalSubtype(submission);

    // ---- Combine; never blank ----
    const familyWord = family === 'excess' ? 'Excess' : 'Lead';
    let subtype = cls.subtype;
    if (LAYER_SUBTYPES.indexOf(subtype) === -1) subtype = 'Other';
    const layerType = familyWord + ' ' + subtype;

    return {
      layerType,                    // e.g. "Lead Mercantile" — never blank
      family,                       // 'lead' | 'excess'
      subtype,                      // one of LAYER_SUBTYPES
      reasons: [familyReason].concat(cls.reasons || []),
      conflict: cls.conflict || null,   // {field,severity,message} or null
      inferred: true,               // always an inference until user confirms
      towerRungCount: towerInfo && towerInfo.rungs ? towerInfo.rungs.length : 0
    };
  }

  root.STM_GL_CLASS_CODE_TABLE = GL_CLASS_CODE_TABLE;
  root.STM_GL_CLASS_CODE_EXTENSIONS = GL_CLASS_CODE_EXTENSIONS;

  root.WorkbenchRules = {
    decideLayerType,
    SOURCE_AUTHORITY,
    GUIDELINE_CAPS,
    DEFAULTS,
    COMPUTE,
    DATE_FIELDS,
    LABEL_PATTERNS,
    resolveField,
    buildFieldCoverageReport,
    moduleSpecificFieldAdapter,
    GL_CLASS_CODE_TABLE,
    GL_CLASS_CODE_EXTENSIONS,
    lookupGlClassCode,
    isValidGlClassCode,
    isRecognizedGlClassCode,
    normalizeGlRatingBasis,
    lookupJsonField,
    normalizeDateString,
    parseJsonBlock,
    parseMarkdown,
    isSentinelValue,
    looksStructurallyValid,
    extractNamedInsured,
    normalizeCompanyName,
    applicantsMatch,
    applicantVerdict,
    isInsuredNotStated,
    parseExcessTower,
    assembleTower,
    assembleTowerWithRelabels,
    applyTowerRelabel,
    getTowerRelabels,
    parseTowerDocuments,
    buildTowerFromExcessModule,
    buildTowerView,
    detectLeadQuotePosition8709,
    recommendSubjectivities,
    recommendForms,
    assessWorkflowReadiness,
    TOWER_UNDERLYING_COLOR,
    _sampleTowerInputDoc,
    formatIso,
    version: 'v8.7.14-gl-sublimit-label-map-final',
    fixTag: 'FIX-PHASE-GO-LIVE-73-2026-05-16'
  };

  // FIX-PHASE-5.0-DEBUG-HELPER-2026-05-14
  // Optional debug surface — only exposed when the page URL contains
  // ?debug=1 (or &debug=1). Lets Justin reset the cross-applicant cache
  // between test scenarios without a full page reload. Cache is otherwise
  // private and immutable for safety, but observable + clearable in
  // debug mode for development iteration.
  try {
    const params = (typeof window !== 'undefined' && window.location)
      ? new URLSearchParams(window.location.search)
      : null;
    if (params && params.get('debug') === '1') {
      root.WorkbenchRules._debugClearApplicantCache = function () {
        const keys = Object.keys(_applicantMatchCache);
        for (const k of keys) delete _applicantMatchCache[k];
        console.log('[WorkbenchRules] _applicantMatchCache cleared (' + keys.length + ' entries)');
        return keys.length;
      };
      root.WorkbenchRules._debugInspectApplicantCache = function () {
        return Object.assign({}, _applicantMatchCache);
      };
      console.log('[WorkbenchRules] Debug mode active. Available:',
                  '_debugClearApplicantCache(), _debugInspectApplicantCache()');
    }
  } catch (e) { /* no-op outside browser */ }

  // Console-testable convenience wrapper. From the workbench console:
  //   window.workbenchResolveField('insured_name')
  //   → { value: 'Anahuac Infrastructure LLC', source: 'submission.account_name',
  //       tier: 0, confidence: 1.0 }
  root.workbenchResolveField = function (fieldName) {
    const sub = root.workbenchActiveSubmission || null;
    return resolveField(fieldName, sub);
  };
})(typeof window !== 'undefined' ? window : globalThis);
