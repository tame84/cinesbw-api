interface MovieData {
    imdbId: string | null;
    tmdbId: number | null;
    slug: string;
    title: string;
    releaseDate: string | null;
    runtime: number;
    genres: string[];
    overview: string;
    originalLanguage: string | null;
    directors: string[];
    actors: string[];
    backdrop: {
        medium: string;
        large: string;
    } | null;
    poster: {
        small: string;
        medium: string;
        large: string;
    } | null;
    videos:
        | {
              name: string;
              key: string;
          }[]
        | null;
}

export interface Show {
    date: string; // YYYY-MM-DDT00:00:00+hh:mm
    cinemas: {
        cinema: {
            name: string;
            id: number;
        };
        showtimes: {
            showDatetime: string; // YYYY-MM-DDThh:mm:ss+hh:mm
            version: {
                short: string;
                long: string;
            };
        }[];
    }[];
}

export interface Movie {
    movie: MovieData;
    shows: Show[];
}

export enum CinemaEnum {
    CINES_WELLINGTON = 60,
    CINEMA_ETOILE = 3946,
    CINE_CENTRE = 209,
    CINE4 = 62932,
    KINEPOLIS_IMAGIBRAINE = 57,
    PATHE_LOUVAIN_LA_NEUVE = 12383,
}

export enum VersionEnum {
    VO = "VO",
    VF = "VF",
    VN = "VN",
}
