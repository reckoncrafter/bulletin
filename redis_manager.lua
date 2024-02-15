--[[
    Checks each SET.
    If a key is present in a set,
    but not in the database,
    remove it from the set
]]--
-- redis.__Categories = {'APPROVED','PENDING','DENIED'}

do local a = {}; for k,v in pairs({'APPROVED','PENDING','DENIED'}) do local keyset = redis.call('SMEMBERS',v); for _k,_v in pairs(keyset) do if not redis.call('GET', _v) then table.insert(a,{v,_v}) end end end return a end

--[[
    DEL a key, while also SREM that key
    from whatever set it is present in
]]--
do for k,v in pairs({'APPROVED', 'PENDING', 'DENIED'}) do redis.call('SREM', v, ARGV[1]) end return redis.call('DEL', ARGV[1]) end