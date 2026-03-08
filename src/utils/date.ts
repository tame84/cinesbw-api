export const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}-${month}-${day}`;
};

export const createUTCDate = (day: number, month: number, year: number = new Date().getFullYear()) => {
    return new Date(Date.UTC(year, month - 1, day));
};

export const createUTCDatetime = (date: Date, hours: number, minutes: number): Date => {
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes));
};
