const API_URL =
  "https://bigquery-to-api-700799484168.southamerica-east1.run.app";

export async function getProducts() {
  const response = await fetch(API_URL);

  if (!response.ok) {
    throw new Error("Error al obtener productos");
  }

  return await response.json();
}