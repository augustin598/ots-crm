##make the dict for ISO 3166-2:RO
def get_counties():
    counties = {}
    counties["AB"] = "Alba"
    counties["AR"] = "Arad"
    counties["AG"] = "Argeș"
    counties["BC"] = "Bacău"
    counties["BH"] = "Bihor"
    counties["BN"] = "Bistrița-Năsăud"
    counties["BT"] = "Botoșani"
    counties["BV"] = "Brașov"
    counties["BR"] = "Brăila"
    counties["B"] = "București"
    counties["BZ"] = "Buzău"
    counties["CS"] = "Caraș-Severin"
    counties["CL"] = "Călărași"
    counties["CJ"] = "Cluj"
    counties["CT"] = "Constanța"
    counties["CV"] = "Covasna"
    counties["DB"] = "Dâmbovița"
    counties["DJ"] = "Dolj"
    counties["GL"] = "Galați"
    counties["GR"] = "Giurgiu"
    counties["GJ"] = "Gorj"
    counties["HR"] = "Harghita"
    counties["HD"] = "Hunedoara"
    counties["IL"] = "Ialomița"
    counties["IS"] = "Iași"
    counties["IF"] = "Ilfov"
    counties["MM"] = "Maramureș"
    counties["MH"] = "Mehedinți"
    counties["MS"] = "Mureș"
    counties["NT"] = "Neamț"
    counties["OT"] = "Olt"
    counties["PH"] = "Prahova"
    counties["SM"] = "Satu Mare"
    counties["SJ"] = "Sălaj"
    counties["SB"] = "Sibiu"
    counties["SV"] = "Suceava"
    counties["TR"] = "Teleorman"
    counties["TM"] = "Timiș"
    counties["TL"] = "Tulcea"
    counties["VS"] = "Vaslui"
    counties["VL"] = "Vâlcea"
    counties["VN"] = "Vrancea"
    return counties


##create the variants for the county without the diacritics
def get_counties_no_diacritics():
    counties = {}
    counties["AB"] = "Alba"
    counties["AR"] = "Arad"
    counties["AG"] = "Arges"
    counties["BC"] = "Bacau"
    counties["BH"] = "Bihor"
    counties["BN"] = "Bistrita-Nasaud"
    counties["BT"] = "Botosani"
    counties["BV"] = "Brasov"
    counties["BR"] = "Braila"
    counties["B"] = "Bucuresti"
    counties["BZ"] = "Buzau"
    counties["CS"] = "Caras-Severin"
    counties["CL"] = "Calarasi"
    counties["CJ"] = "Cluj"
    counties["CT"] = "Constanta"
    counties["CV"] = "Covasna"
    counties["DB"] = "Dambovita"
    counties["DJ"] = "Dolj"
    counties["GL"] = "Galati"
    counties["GR"] = "Giurgiu"
    counties["GJ"] = "Gorj"
    counties["HR"] = "Harghita"
    counties["HD"] = "Hunedoara"
    counties["IL"] = "Ialomita"
    counties["IS"] = "Iasi"
    counties["IF"] = "Ilfov"
    counties["MM"] = "Maramures"
    counties["MH"] = "Mehedinti"
    counties["MS"] = "Mures"
    counties["NT"] = "Neamt"
    counties["OT"] = "Olt"
    counties["PH"] = "Prahova"
    counties["SM"] = "Satu Mare"
    counties["SJ"] = "Salaj"
    counties["SB"] = "Sibiu"
    counties["SV"] = "Suceava"
    counties["TR"] = "Teleorman"
    counties["TM"] = "Timis"
    counties["TL"] = "Tulcea"
    counties["VS"] = "Vaslui"
    counties["VL"] = "Valcea"
    counties["VN"] = "Vrancea"
    return counties


##map them to like this {'Arges', 'AB'} and also {'Argeș', 'AG'} and {'arges', 'AG'} and {'argeș', 'ag'}
def get_counties_map():
    ##map the counties to the county code
    counties_map = {}
    countries = get_counties()
    countries_no_diacritics = get_counties_no_diacritics()
    for key, value in countries.items():
        counties_map[value] = key
        counties_map[value.lower()] = key
    for key, value in countries_no_diacritics.items():
        counties_map[value] = key
        counties_map[value.lower()] = key
    return counties_map


def get_county_code(county):
    counties_map = get_counties_map()
    return counties_map[county]
