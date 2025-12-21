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
        slug: string;
        title: string;
        releaseDate: Date;
        runtime: number;
        genres: string[];
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
