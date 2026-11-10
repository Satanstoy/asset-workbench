package com.assetworkbench.asset;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface AssetMapper {
    @Select("""
            SELECT mime_type, size_bytes, width, height FROM assets
            WHERE id = #{id} AND owner_id = #{ownerId}
            """)
    Asset findOwned(@Param("id") String id, @Param("ownerId") String ownerId);

    @Insert("""
            INSERT INTO assets (id, owner_id, mime_type, size_bytes, width, height, storage_name)
            VALUES (#{id}, #{ownerId}, #{asset.mimeType}, #{asset.sizeBytes},
                    #{asset.width}, #{asset.height}, #{storageName})
            """)
    void insert(@Param("id") String id, @Param("ownerId") String ownerId,
                @Param("asset") Asset asset, @Param("storageName") String storageName);

    record Asset(String mimeType, long sizeBytes, int width, int height) {
    }
}
