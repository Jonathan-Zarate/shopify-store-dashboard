import { useEffect, useState } from "react";
import { getProducts } from "../services/productService";

function Products() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const data = await getProducts();

        setProducts(data.products || []);
      } catch (error) {
        console.error("Error cargando productos:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, []);

  if (loading) {
    return <h2>Cargando productos...</h2>;
  }

  return (
    <div style={{ padding: "20px" }}>
      <h1>Productos Shopify</h1>

      <table
        border="1"
        cellPadding="10"
        style={{
          borderCollapse: "collapse",
          width: "100%",
        }}
      >
        <thead>
          <tr>
            <th>ID</th>
            <th>Título</th>
            <th>Vendor</th>
            <th>Tipo</th>
            <th>Estado</th>
            <th>Creado</th>
          </tr>
        </thead>

        <tbody>
          {products.map((product, index) => (
            <tr key={`${product.id}-${index}`}>
              <td>{product.id}</td>
              <td>{product.title}</td>
              <td>{product.vendor}</td>
              <td>{product.product_type}</td>
              <td>{product.status}</td>
              <td>{product.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Products;