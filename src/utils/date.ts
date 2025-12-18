export const createUTCDate = (day: number, month: number, year: number = new Date().getFullYear()) => {
    return new Date(Date.UTC(year, month - 1, day));
};

export const createUTCDateTime = (date: Date, hours: number, minutes: number): Date => {
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes));
};
