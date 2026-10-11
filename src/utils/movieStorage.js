const KEY = "movies";

export const getMovies = () => {
  return JSON.parse(localStorage.getItem(KEY)) || [];
};

export const saveMovies = (movies) => {
  localStorage.setItem(KEY, JSON.stringify(movies));
};