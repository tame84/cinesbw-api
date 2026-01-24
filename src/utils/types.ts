interface Show {
    date: Date;
    cinemas: {
        cinema: {
            yellowName: string;
            yellowId: number;
        };
        times: {
            showDateTime: Date;
            version: {
                short: string;
                long: string;
            };
        }[];
    }[];
}

export interface Movie {
    movie: {
        imdbId: string | null;
        tmdbId: number | null;
        slug: string;
        title: string;
        releaseDate: Date;
        runtime: number;
        genres: string[];
        originalLanguage: string | null;
        directors: string[];
        actors: string[];
        overview: string;
        backdrop: {
            medium: string;
            large: string;
        };
        poster: {
            small: string;
            medium: string;
            large: string;
        };
        videos: {
            name: string;
            key: string;
        }[];
    };
    shows: Show[];
}
