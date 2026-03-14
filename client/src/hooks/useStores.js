import { useState, useEffect } from "react";
import { fetchStores } from "../utils/api";

export default function useStores() {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchStores()
      .then((res) => setStores(res.data || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { stores, loading, error };
}
